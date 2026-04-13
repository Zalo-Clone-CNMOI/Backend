import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/decorator';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { HealthCheckService, HealthCheckResult } from '@libs/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    @Inject(APP_CONFIG)
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Deep health check with dependency validation' })
  async health(): Promise<HealthCheckResult> {
    return this.healthCheckService.executeHealthChecks('media-service', [
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
}
