import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { AccessToken, Public } from '@app/decorator';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { MonitoringService } from './monitoring.service';

@ApiTags('Monitoring')
@ApiBearerAuth('BearerAuth')
@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly service: MonitoringService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Verify JWT + admin allowlist (by userId/sub). Returns userId. */
  private requireAdmin(token: string | null): string {
    if (!token) throw BusinessException.unauthorized('Authentication required');
    const { sub: userId } = this.jwt.verifyAccessToken(token);
    const admins = this.config.adminUserIds ?? [];
    if (!admins.includes(userId)) {
      throw BusinessException.forbidden('Admin access required');
    }
    return userId;
  }

  @Get('containers')
  @ApiOperation({ summary: 'Container status (admin only)' })
  containers(@AccessToken() token: string | null) {
    this.requireAdmin(token);
    return this.service.getContainers();
  }

  @Get('containers/:id/logs')
  @ApiOperation({ summary: 'Container logs (admin only)' })
  logs(
    @AccessToken() token: string | null,
    @Param('id') id: string,
    @Query('level') level?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireAdmin(token);
    return this.service.getContainerLogs(
      id,
      level,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('ai-analyze')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'LLM analysis (admin only, rate-limited 5/min)' })
  aiAnalyze(
    @AccessToken() token: string | null,
    @Body() body: { question: string },
  ) {
    const userId = this.requireAdmin(token);
    return this.service.aiAnalyze(userId, body.question);
  }

  // Machine-to-machine for UptimeRobot — uses X-Monitor-Token, not JWT.
  @Public()
  @Get('stack-health')
  @ApiOperation({
    summary: 'Composite stack health (UptimeRobot, X-Monitor-Token)',
  })
  stackHealth(@Headers('x-monitor-token') monitorToken?: string) {
    const expected = this.config.monitorToken ?? '';
    const got = monitorToken ?? '';
    const ab = Buffer.from(got);
    const eb = Buffer.from(expected);
    const valid =
      eb.length > 0 && ab.length === eb.length && timingSafeEqual(ab, eb);
    if (!valid) {
      throw BusinessException.unauthorized('Invalid monitor token');
    }
    return this.service.getStackHealth();
  }
}
