import { Injectable, Logger } from '@nestjs/common';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    [key: string]: {
      status: 'up' | 'down';
      message?: string;
      responseTime?: number;
      details?: any;
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
        details?: any;
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
    connection: any,
  ): Promise<{ status: 'up' | 'down'; message?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  async checkRedis(
    client: any,
  ): Promise<{ status: 'up' | 'down'; message?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await client.ping();
      return { status: 'up' };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `Redis connection failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Kafka health check
   */
  async checkKafka(
    admin: any,
  ): Promise<{ status: 'up' | 'down'; message?: string; details?: any }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const cluster = await admin.describeCluster();
      return {
        status: 'up',
        details: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
          brokers: cluster.brokers.length,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
          controller: cluster.controller,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `Kafka connection failed: ${errorMessage}`,
      };
    }
  }

  /**
   * ScyllaDB health check
   */
  async checkScylla(
    client: any,
  ): Promise<{ status: 'up' | 'down'; message?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await client.execute('SELECT now() FROM system.local');
      return { status: 'up' };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'down',
        message: `ScyllaDB connection failed: ${errorMessage}`,
      };
    }
  }
}
