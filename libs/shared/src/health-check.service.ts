import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';

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
          const result = await Promise.race([
            check(),
            this.timeout(5000), // 5 second timeout
          ]);
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

    // Determine overall status
    const allUp = Object.values(results).every((r) => r.status === 'up');
    const someDown = Object.values(results).some((r) => r.status === 'down');

    let status: HealthCheckResult['status'];
    if (allUp) {
      status = 'healthy';
    } else if (someDown) {
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

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Health check timeout after ${ms}ms`)),
        ms,
      ),
    );
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
   * Kafka health check
   */
  async checkKafka(config: KafkaHealthConfig): Promise<{
    status: 'up' | 'down';
    message?: string;
    details?: HealthCheckDetail;
  }> {
    const admin = new Kafka({
      clientId: `${config.clientId}-health-check`,
      brokers: config.brokers,
      connectionTimeout: 5000,
      requestTimeout: 5000,
      retry: {
        retries: 0,
      },
    }).admin();

    try {
      await admin.connect();
      const cluster = await admin.describeCluster();

      return {
        status: 'up',
        details: {
          dependency: 'kafka',
          probe: 'describeCluster',
          brokers: cluster.brokers.length,
          controller: cluster.controller,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `Dependency kafka unavailable: ${errorMessage}`,
      };
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
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
