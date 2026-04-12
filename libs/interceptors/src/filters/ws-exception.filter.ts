import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { WsEvents, type WsErrorPayload } from '@libs/contracts';

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    const payload = this.buildPayload(exception);
    client.emit(WsEvents.WsError, payload);
  }

  private buildPayload(exception: unknown): WsErrorPayload {
    if (exception instanceof WsException) {
      const error = exception.getError();

      if (typeof error === 'string') {
        // NestJS guard returns false → WsException('Forbidden')
        const code = error === 'Forbidden' ? 'FORBIDDEN' : 'UNAUTHORIZED';
        return { code, message: error };
      }

      if (typeof error === 'object' && error !== null) {
        const errObj = error as Record<string, unknown>;
        return {
          code: typeof errObj.code === 'string' ? errObj.code : 'WS_ERROR',
          message:
            typeof errObj.message === 'string'
              ? errObj.message
              : 'WebSocket error',
        };
      }
    }

    if (exception instanceof Error) {
      this.logger.error(
        `Unhandled WS exception: ${exception.message}`,
        exception.stack,
      );
      return { code: 'INTERNAL_SERVER_ERROR', message: exception.message };
    }

    this.logger.error('Unknown WS exception type', String(exception));
    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    };
  }
}
