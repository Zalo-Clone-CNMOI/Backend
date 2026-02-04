import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Middleware to generate and propagate correlation IDs across service boundaries
 * Enables distributed request tracing
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers[CORRELATION_ID_HEADER] as string) || uuidv4();

    const requestId = uuidv4();

    const store = new Map<string, any>();
    store.set('correlationId', correlationId);
    store.set('requestId', requestId);
    store.set('timestamp', Date.now());

    (req as unknown as { correlationId: string }).correlationId = correlationId;
    (req as unknown as { requestId: string }).requestId = requestId;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    asyncLocalStorage.run(store, () => {
      next();
    });
  }
}

export function getCorrelationId(): string | undefined {
  const store = asyncLocalStorage.getStore();
  return store?.get('correlationId') as string | undefined;
}

export function getRequestId(): string | undefined {
  const store = asyncLocalStorage.getStore();
  return store?.get('requestId') as string | undefined;
}

export function getRequestContext(): {
  correlationId?: string;
  requestId?: string;
  timestamp?: number;
} {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return {};
  }

  return {
    correlationId: store.get('correlationId') as string | undefined,
    requestId: store.get('requestId') as string | undefined,
    timestamp: store.get('timestamp') as number | undefined,
  };
}
