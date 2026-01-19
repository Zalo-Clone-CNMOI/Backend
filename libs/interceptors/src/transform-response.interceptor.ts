import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Standard API response interface
 */
export interface StandardResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  meta?: Record<string, unknown>;
}

/**
 * Transform response interceptor
 * Wraps all responses in a standard format
 */
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // If data already has success property, return as-is (already formatted)
        if (data && typeof data === 'object' && 'success' in data) {
          return data as StandardResponse<T>;
        }

        // Handle paginated responses
        if (
          data &&
          typeof data === 'object' &&
          'items' in data &&
          'meta' in data
        ) {
          const paginatedData = data as { items: T; meta: unknown };
          return {
            success: true,
            data: paginatedData.items,
            meta: paginatedData.meta,
            timestamp: new Date().toISOString(),
          } as StandardResponse<T>;
        }

        // Wrap in standard response format
        return {
          success: true,
          data: data as T,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
