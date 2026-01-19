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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data: any) => {
        const executionTime = Date.now() - startTime;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response = context.switchToHttp().getResponse();

        this.logger.log(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `Response for ${request.method} ${request.url} - Status: ${response.statusCode} - Execution Time: ${executionTime}ms`,
        );

        return {
          success: !(data instanceof Error) && data !== null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
