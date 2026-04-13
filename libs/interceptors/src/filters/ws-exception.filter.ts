import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { WsEvents, type WsErrorPayload } from '@libs/contracts';
import { BusinessException } from '@app/types';
import { ErrorCode } from '@app/constant';

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    const payload = this.buildPayload(exception);
    client.emit(WsEvents.WsError, payload);
  }

  private buildPayload(exception: unknown): WsErrorPayload {
    const timestamp = new Date().toISOString();

    if (exception instanceof BusinessException) {
      const exceptionResponse = exception.getResponse() as Record<
        string,
        unknown
      >;
      return {
        code: exception.errorCode,
        message:
          ((exceptionResponse.error as Record<string, unknown>)
            ?.message as string) ?? 'WebSocket error',
        details: exception.details,
        timestamp,
      };
    }

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      let message = exception.message;
      let details: unknown;

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        if (Array.isArray(responseObj.message)) {
          message = 'Validation failed';
          details = responseObj.message;
        } else {
          message = (responseObj.message as string) ?? exception.message;
        }
      }

      return {
        code: this.mapStatusToErrorCode(exception.getStatus()),
        message,
        ...(details !== undefined && details !== null ? { details } : {}),
        timestamp,
      };
    }

    if (exception instanceof WsException) {
      const error = exception.getError();

      if (typeof error === 'string') {
        // NestJS guard returns false → WsException('Forbidden')
        const code = error === 'Forbidden' ? 'FORBIDDEN' : 'UNAUTHORIZED';
        return { code, message: error, timestamp };
      }

      if (typeof error === 'object' && error !== null) {
        const errObj = error as Record<string, unknown>;
        return {
          code: typeof errObj.code === 'string' ? errObj.code : 'WS_ERROR',
          message:
            typeof errObj.message === 'string'
              ? errObj.message
              : 'WebSocket error',
          details: errObj.details,
          timestamp,
        };
      }
    }

    if (exception instanceof Error) {
      this.logger.error(
        `Unhandled WS exception: ${exception.message}`,
        exception.stack,
      );
      return {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        timestamp,
      };
    }

    this.logger.error('Unknown WS exception type', String(exception));
    return {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      timestamp,
    };
  }

  private mapStatusToErrorCode(status: number): ErrorCode {
    const statusCode = status as HttpStatus;
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }
}
