import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';

const TIMEOUT_MS = 30_000;

/**
 * Proxies monitoring requests to ai-core-service's internal /monitoring API,
 * authenticating with the shared X-Internal-Token. BFF never talks to
 * Prometheus/Loki directly — only ai-core does (keeps the brain on EC2).
 */
@Injectable()
export class MonitoringService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get base(): string {
    return `${this.config.aiCoreServiceUrl}/monitoring`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Internal-Token': this.config.internalMonitoringToken ?? '',
    };
  }

  private async call<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: init?.method ?? 'GET',
      headers: this.headers(),
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`ai-core monitoring ${path} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  getContainers<T = unknown>(): Promise<T> {
    return this.call<T>('/containers');
  }

  getContainerLogs<T = unknown>(
    id: string,
    level?: string,
    limit?: number,
  ): Promise<T> {
    const q = new URLSearchParams();
    if (level) q.set('level', level);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return this.call<T>(
      `/containers/${encodeURIComponent(id)}/logs${qs ? `?${qs}` : ''}`,
    );
  }

  getStackHealth<T = unknown>(): Promise<T> {
    return this.call<T>('/stack-health');
  }

  aiAnalyze<T = unknown>(userId: string, question: string): Promise<T> {
    return this.call<T>('/ai-analyze', {
      method: 'POST',
      body: { userId, question },
    });
  }
}
