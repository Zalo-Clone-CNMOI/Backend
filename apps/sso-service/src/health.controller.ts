import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '@app/decorator';
import { HealthCheckService, HealthCheckResult } from '@libs/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Deep health check with dependency validation' })
  async health(): Promise<HealthCheckResult> {
    return await this.healthCheckService.executeHealthChecks('sso-service', [
      {
        name: 'postgres',
        check: async () =>
          this.healthCheckService.checkPostgres(this.dataSource),
      },
      {
        name: 'self',
        check: async () => await Promise.resolve({ status: 'up' }),
      },
    ]);
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Kubernetes readiness probe' })
  ready(): { ready: boolean } {
    return { ready: this.dataSource.isInitialized };
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  live(): { alive: boolean } {
    return { alive: true };
  }
}
