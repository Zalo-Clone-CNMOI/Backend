import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/decorator';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';
import { SCYLLA_CLIENT } from '@libs/scylla';
import { HealthCheckResult, HealthCheckService } from '@libs/shared';
import type { Client } from 'cassandra-driver';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG)
    private readonly config: AppConfig,
    @Inject(SCYLLA_CLIENT)
    private readonly scyllaClient: Client,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Deep health check with dependency validation' })
  async health(): Promise<HealthCheckResult> {
    return this.healthCheckService.executeHealthChecks('ws-gateway', [
      {
        name: 'kafka',
        check: () =>
          this.healthCheckService.checkKafka({
            clientId: this.config.kafkaClientId,
            brokers: this.config.kafkaBrokers,
          }),
      },
      {
        name: 'redis',
        check: () => this.healthCheckService.checkRedis(this.redisService),
      },
      {
        name: 'scylla',
        check: () => this.healthCheckService.checkScylla(this.scyllaClient),
      },
    ]);
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  live(): { alive: boolean } {
    return { alive: true };
  }
}
