import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';

interface HealthCheckDetail {
  [key: string]: unknown;
}

interface PostgresConnection {
  query(sql: string): Promise<unknown>;
}

interface RedisClient {
  ping(): Promise<unknown>;
}

interface KafkaHealthConfig {
  clientId: string;
  brokers: string[];
}

interface ScyllaClient {
  execute(cql: string): Promise<unknown>;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    [key: string]: {
      status: 'up' | 'down';
      message?: string;
      responseTime?: number;
      details?: HealthCheckDetail;
    };
  };
  timestamp: string;
  service: string;
  version?: string;
}

/**
 * Base Health Check Service
 * Provides infrastructure for deep health checks across dependencies
 */
@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  /**
   * Execute multiple health checks in parallel
   */
  async executeHealthChecks(
    serviceName: string,
    checks: Array<{
      name: string;
      check: () => Promise<{
        status: 'up' | 'down';
        message?: string;
        details?: HealthCheckDetail;
      }>;
    }>,
  ): Promise<HealthCheckResult> {
    const results: HealthCheckResult['checks'] = {};

    await Promise.allSettled(
      checks.map(async ({ name, check }) => {
        const checkStart = Date.now();
        try {
          const { promise: timeoutPromise, cancel } = this.makeTimeout(5000);
          const result = await Promise.race([check(), timeoutPromise]);
          cancel(); // prevent the timer handle from leaking after a successful check
          results[name] = {
            ...result,
            responseTime: Date.now() - checkStart,
          };
        } catch (error: unknown) {
          this.logger.error(`Health check failed for ${name}:`, error);
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          results[name] = {
            status: 'down',
            message: errorMessage,
            responseTime: Date.now() - checkStart,
          };
        }
      }),
    );

    // Determine overall status:
    // - healthy  → every check is up
    // - unhealthy → every check is down
    // - degraded  → some (but not all) checks are down
    const statuses = Object.values(results).map((r) => r.status);
    const allUp = statuses.every((s) => s === 'up');
    const allDown = statuses.every((s) => s === 'down');

    let status: HealthCheckResult['status'];
    if (allUp) {
      status = 'healthy';
    } else if (allDown) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    return {
      status,
      checks: results,
      timestamp: new Date().toISOString(),
      service: serviceName,
      version: process.env.npm_package_version,
    };
  }

  private makeTimeout(ms: number): {
    promise: Promise<never>;
    cancel: () => void;
  } {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
      handle = setTimeout(
        () => reject(new Error(`Health check timeout after ${ms}ms`)),
        ms,
      );
    });
    return { promise, cancel: () => clearTimeout(handle) };
  }

  /**
   * PostgreSQL health check
   */
  async checkPostgres(
    connection: PostgresConnection,
  ): Promise<{ status: 'up' | 'down'; message?: string }> {
    try {
      await connection.query('SELECT 1');
      return { status: 'up' };
    } catch (error: unknown) {
      return {
        status: 'down',
        message: `PostgreSQL connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Redis health check
   */
  async checkRedis(client: RedisClient): Promise<{
    status: 'up' | 'down';
    message?: string;
    details?: HealthCheckDetail;
  }> {
    try {
      const pong = await client.ping();
      return {
        status: 'up',
        details: {
          dependency: 'redis',
          probe: 'PING',
          response: pong,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `Dependency redis unavailable: ${errorMessage}`,
      };
    }
  }

  /**
   * Kafka health check — lightweight TCP probe against the first broker.
   * Avoids the cost of creating a full KafkaJS admin client per invocation
   * (no metadata fetch, no auth handshake). Sufficient to verify broker reachability.
   */
  async checkKafka(config: KafkaHealthConfig): Promise<{
    status: 'up' | 'down';
    message?: string;
    details?: HealthCheckDetail;
  }> {
    const [host, portStr] = (config.brokers[0] ?? '').split(':');
    const port = Number(portStr) || 9092;

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });

      const onConnect = () => {
        socket.destroy();
        resolve({
          status: 'up',
          details: {
            dependency: 'kafka',
            probe: 'tcp-connect',
            broker: config.brokers[0],
          },
        });
      };

      const onError = (err: Error) => {
        socket.destroy();
        resolve({
          status: 'down',
          message: `Dependency kafka unavailable: ${err.message}`,
        });
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }

  /**
   * ScyllaDB health check
   */
  async checkScylla(client: ScyllaClient): Promise<{
    status: 'up' | 'down';
    message?: string;
    details?: HealthCheckDetail;
  }> {
    try {
      await client.execute('SELECT now() FROM system.local');
      return {
        status: 'up',
        details: {
          dependency: 'scylla',
          probe: 'SELECT now() FROM system.local',
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `Dependency scylla unavailable: ${errorMessage}`,
      };
    }
  }
}
