import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { APP_CONFIG, AppConfig } from '@libs/config';

/**
 * Guards internal-only HTTP endpoints (e.g. ai-core monitoring) behind a shared
 * secret header. The BFF is the only legitimate caller; it forwards
 * `X-Internal-Token` matching `INTERNAL_MONITORING_TOKEN`. Fails closed when the
 * secret is not configured.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
      return true;
    }
    const expected = this.config.internalMonitoringToken;
    if (!expected) {
      this.logger.warn('InternalTokenGuard: secret not configured — deny');
      return false; // fail closed
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-internal-token'] as string | undefined;
    if (token !== expected) {
      this.logger.warn('InternalTokenGuard: token missing/mismatch');
      return false;
    }
    return true;
  }
}
