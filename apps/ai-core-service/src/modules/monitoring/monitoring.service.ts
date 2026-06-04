import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import {
  ALLOWED_LOG_LEVELS,
  HEALTH_QUERY_TIMEOUT_MS,
  MAX_LOG_LIMIT,
  MONITORED_CONTAINERS,
  PROMQL,
} from './monitoring.constants';
import {
  AiAnalyzeResult,
  ContainerStatus,
  LogLine,
  StackHealth,
} from './dto/monitoring.types';

interface PromVector {
  status: string;
  data?: {
    result?: Array<{ metric: Record<string, string>; value: [number, string] }>;
  };
}
interface LokiResp {
  status: string;
  data?: {
    result?: Array<{
      stream: Record<string, string>;
      values: [string, string][];
    }>;
  };
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
  ) {}

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(HEALTH_QUERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async promInstant(query: string): Promise<PromVector> {
    const url = `${this.config.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    try {
      return await this.getJson<PromVector>(url);
    } catch (e) {
      this.logger.warn(
        `Prometheus query failed (${query}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
      return { status: 'error' };
    }
  }

  /** Map PromVector → { containerName: numericValue } by label `name`. */
  private vectorByName(v: PromVector): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of v.data?.result ?? []) {
      const name = r.metric.name;
      if (name) out[name] = Number(r.value[1]);
    }
    return out;
  }

  /** Map probe_success → { service: 'up'|'down' } by instance URL. */
  private probeByService(v: PromVector): Record<string, 'up' | 'down'> {
    const out: Record<string, 'up' | 'down'> = {};
    for (const r of v.data?.result ?? []) {
      const instance = r.metric.instance ?? '';
      const match = MONITORED_CONTAINERS.find((c) =>
        instance.includes(`//${c.service}:`),
      );
      if (match) out[match.service] = Number(r.value[1]) === 1 ? 'up' : 'down';
    }
    return out;
  }

  async getContainers(): Promise<ContainerStatus[]> {
    const [up, restarts, uptime, probe] = await Promise.all([
      this.promInstant(PROMQL.up),
      this.promInstant(PROMQL.restarts24h),
      this.promInstant(PROMQL.uptime),
      this.promInstant(PROMQL.probeSuccess),
    ]);
    const upMap = this.vectorByName(up);
    const restartMap = this.vectorByName(restarts);
    const uptimeMap = this.vectorByName(uptime);
    const probeMap = this.probeByService(probe);

    return MONITORED_CONTAINERS.map((c) => ({
      service: c.service,
      container: c.container,
      up: upMap[c.container] === 1,
      restarts24h: restartMap[c.container] ?? 0,
      uptimeSeconds: Math.max(0, Math.round(uptimeMap[c.container] ?? 0)),
      healthProbe: probeMap[c.service] ?? 'unknown',
    }));
  }

  async getContainerLogs(
    container: string,
    level: string | undefined,
    limit: number,
  ): Promise<LogLine[]> {
    // Defense-in-depth: only allow known containers + known log levels before
    // interpolating into LogQL (prevents selector/pipeline injection).
    const known = MONITORED_CONTAINERS.find((c) => c.container === container);
    if (!known) {
      throw new Error(`Unknown container: ${container}`);
    }
    const normalizedLevel = level?.trim().toUpperCase();
    const safeLevel = (ALLOWED_LOG_LEVELS as readonly string[]).includes(
      normalizedLevel ?? '',
    )
      ? normalizedLevel
      : undefined;
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || 100),
      MAX_LOG_LIMIT,
    );

    const selector = safeLevel
      ? `{container="${container}"} |= "${safeLevel}"`
      : `{container="${container}"}`;
    const end = Date.now() * 1_000_000; // ns
    const start = (Date.now() - 60 * 60 * 1000) * 1_000_000; // 1h ago, ns
    const url =
      `${this.config.lokiUrl}/loki/api/v1/query_range` +
      `?query=${encodeURIComponent(selector)}` +
      `&limit=${safeLimit}&start=${start}&end=${end}&direction=backward`;
    const resp = await this.getJson<LokiResp>(url);
    const lines: LogLine[] = [];
    for (const stream of resp.data?.result ?? []) {
      for (const [ts, line] of stream.values) {
        lines.push({
          timestamp: new Date(Number(ts) / 1_000_000).toISOString(),
          line,
        });
      }
    }
    return lines;
  }

  async getStackHealth(): Promise<StackHealth> {
    const probe = async (url: string): Promise<'ok' | 'down'> => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(HEALTH_QUERY_TIMEOUT_MS),
        });
        return res.ok ? 'ok' : 'down';
      } catch {
        return 'down';
      }
    };
    const [prometheus, loki, grafana] = await Promise.all([
      probe(`${this.config.prometheusUrl}/-/healthy`),
      probe(`${this.config.lokiUrl}/ready`),
      probe(this.config.grafanaHealthUrl ?? ''),
    ]);
    const services = { prometheus, loki, grafana };
    const vals = Object.values(services);
    const status: StackHealth['status'] = vals.every((v) => v === 'ok')
      ? 'healthy'
      : vals.every((v) => v === 'down')
        ? 'unhealthy'
        : 'degraded';
    return { status, services, timestamp: new Date().toISOString() };
  }

  async aiAnalyze(userId: string, question: string): Promise<AiAnalyzeResult> {
    const [containers, health] = await Promise.all([
      this.getContainers().catch(() => [] as ContainerStatus[]),
      this.getStackHealth().catch(() => null),
    ]);
    const snapshot = JSON.stringify({ containers, stackHealth: health });
    const result = await this.gateway.complete(userId, {
      messages: [
        {
          role: 'system',
          content:
            'Bạn là trợ lý DevOps. Dựa trên snapshot JSON về trạng thái container và stack health, ' +
            'trả lời ngắn gọn bằng tiếng Việt: container nào lỗi, nguyên nhân khả dĩ, đề xuất. ' +
            'Chỉ dựa vào dữ liệu được cung cấp.',
        },
        {
          role: 'user',
          content: `Snapshot:\n${snapshot}\n\nCâu hỏi: ${question}`,
        },
      ],
      maxTokens: 512,
      temperature: 0.2,
    });
    return {
      answer: result.content,
      model: result.model,
      provider: result.provider,
    };
  }
}
