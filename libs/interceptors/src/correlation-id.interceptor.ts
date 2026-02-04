import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getCorrelationId, getRequestId } from '@app/middleware';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      ip: string;
      get: (header: string) => string | undefined;
    }>();
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number }>();
    const { method, url, ip } = request;
    const correlationId = getCorrelationId();
    const requestId = getRequestId();
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    // Log incoming request
    this.logger.log({
      type: 'request',
      method,
      url,
      ip,
      userAgent,
      correlationId,
      requestId,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = response;
          const duration = Date.now() - startTime;

          this.logger.log({
            type: 'response',
            method,
            url,
            statusCode,
            duration: `${duration}ms`,
            correlationId,
            requestId,
          });
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;

          this.logger.error({
            type: 'response-error',
            method,
            url,
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`,
            correlationId,
            requestId,
          });
        },
      }),
    );
  }
}
