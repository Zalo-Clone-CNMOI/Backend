import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { Request, Response } from 'express';

@Injectable()
export class ResponseLoggingInterceptor implements NestInterceptor {
  private readonly logger: Logger;
  constructor() {
    this.logger = new Logger(ResponseLoggingInterceptor.name);
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data: unknown) => {
        const executionTime = Date.now() - startTime;
        const response = context.switchToHttp().getResponse<Response>();

        this.logger.log(
          `Response for ${request.method} ${request.url} - Status: ${response.statusCode} - Execution Time: ${executionTime}ms`,
        );

        return {
          success: !(data instanceof Error) && data !== null,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
