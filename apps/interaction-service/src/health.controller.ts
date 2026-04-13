import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '@app/decorator';
import { HealthCheckService, HealthCheckResult } from '@libs/shared';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly healthCheckService: HealthCheckService,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG)
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Deep health check with dependency validation' })
  @ApiResponse({
    status: 200,
    description: 'Service health status with dependency checks',
  })
  async health(): Promise<HealthCheckResult> {
    return this.healthCheckService.executeHealthChecks('interaction-service', [
      {
        name: 'postgres',
        check: () => this.healthCheckService.checkPostgres(this.dataSource),
      },
      {
        name: 'redis',
        check: () => this.healthCheckService.checkRedis(this.redisService),
      },
      {
        name: 'kafka',
        check: () =>
          this.healthCheckService.checkKafka({
            clientId: this.config.kafkaClientId,
            brokers: this.config.kafkaBrokers,
          }),
      },
    ]);
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Kubernetes readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  ready(): { ready: boolean } {
    // Service is ready if database connection is established
    return { ready: this.dataSource.isInitialized };
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  live(): { alive: boolean } {
    return { alive: true };
  }
}
