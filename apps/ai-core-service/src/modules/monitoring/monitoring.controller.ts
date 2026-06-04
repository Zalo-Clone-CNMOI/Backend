import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalTokenGuard } from '@libs/auth';
import { MonitoringService } from './monitoring.service';
import {
  AiAnalyzeResult,
  ContainerStatus,
  LogLine,
  StackHealth,
} from './dto/monitoring.types';

// Internal-only — guarded by X-Internal-Token. BFF is the only legitimate caller.
@ApiTags('Monitoring (internal)')
@UseGuards(InternalTokenGuard)
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  @Get('containers')
  @ApiOperation({ summary: 'Container status (cAdvisor + blackbox)' })
  containers(): Promise<ContainerStatus[]> {
    return this.service.getContainers();
  }

  @Get('containers/:id/logs')
  @ApiOperation({ summary: 'Container logs from Loki' })
  logs(
    @Param('id') id: string,
    @Query('level') level?: string,
    @Query('limit') limit?: string,
  ): Promise<LogLine[]> {
    const n = limit ? Number(limit) : 100;
    return this.service.getContainerLogs(
      id,
      level,
      Number.isFinite(n) ? n : 100,
    );
  }

  @Get('stack-health')
  @ApiOperation({ summary: 'Composite health of prometheus/loki/grafana' })
  stackHealth(): Promise<StackHealth> {
    return this.service.getStackHealth();
  }

  @Post('ai-analyze')
  @ApiOperation({ summary: 'LLM analysis of current snapshot' })
  aiAnalyze(
    @Body() body: { userId: string; question: string },
  ): Promise<AiAnalyzeResult> {
    return this.service.aiAnalyze(body.userId, body.question);
  }
}
