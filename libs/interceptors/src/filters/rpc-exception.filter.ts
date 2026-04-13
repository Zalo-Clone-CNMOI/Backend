import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, RpcExceptionFilter } from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';
import { ErrorCode } from '@app/constant';
import { BusinessException } from '@app/types';
import type { Observable } from 'rxjs';
import { throwError } from 'rxjs';

interface RpcErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

@Catch()
export class RpcAllExceptionsFilter
  extends BaseRpcExceptionFilter
  implements RpcExceptionFilter<unknown>
{
  private readonly logger = new Logger(RpcAllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    void host;

    const payload = this.toRpcErrorEnvelope(exception);
    this.logger.error(
      `[RPC] ${payload.error.code} ${payload.error.message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    return throwError(() => new RpcException(payload));
  }

  private toRpcErrorEnvelope(exception: unknown): RpcErrorEnvelope {
    let code = ErrorCode.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof BusinessException) {
      const exceptionResponse = exception.getResponse() as Record<
        string,
        unknown
      >;
      code = exception.errorCode;
      message =
        ((exceptionResponse.error as Record<string, unknown>)
          ?.message as string) ?? message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      code = this.mapStatusToErrorCode(status);

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        if (Array.isArray(responseObj.message)) {
          message = 'Validation failed';
          details = responseObj.message;
        } else {
          message = (responseObj.message as string) ?? exception.message;
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof RpcException) {
      const error = exception.getError();
      if (typeof error === 'string') {
        message = error;
      } else if (typeof error === 'object' && error !== null) {
        const errorObject = error as Record<string, unknown>;
        code = (errorObject.code as ErrorCode) ?? code;
        message = (errorObject.message as string) ?? message;
        details = errorObject.details;
      }
    } else if (exception instanceof Error) {
      message = 'Internal server error';
    }

    return {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined && details !== null ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
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
