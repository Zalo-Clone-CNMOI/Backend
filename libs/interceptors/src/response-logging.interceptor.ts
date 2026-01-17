import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseLoggingInterceptor implements NestInterceptor {
  private readonly logger: Logger;
  constructor() {
    this.logger = new Logger(ResponseLoggingInterceptor.name);
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data) => {
        const executionTime = Date.now() - startTime;
        this.logger.log(
          `Response for ${request.method} ${request.url} - Status: ${context.switchToHttp().getResponse().statusCode} - Execution Time: ${executionTime}ms`,
        );

        return {
          success: !(data instanceof Error) && data !== null,
          data: data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
