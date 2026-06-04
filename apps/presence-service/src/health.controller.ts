import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@app/decorator';
import { HealthCheckService, HealthCheckResult } from '@libs/shared';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG)
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Deep health check with dependency validation' })
  async health(): Promise<HealthCheckResult> {
    return this.healthCheckService.executeHealthChecks('presence-service', [
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
    ]);
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  live(): { alive: boolean } {
    return { alive: true };
  }
}
