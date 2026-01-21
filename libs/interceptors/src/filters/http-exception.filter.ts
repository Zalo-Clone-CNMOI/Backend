import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { BusinessException } from '@app/types';
import { ErrorCode } from '@app/constant';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
  path: string;
}
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown = undefined;

    // 1. Handle BusinessException (from backend services)
    if (exception instanceof BusinessException) {
      const exceptionResponse = exception.getResponse() as Record<
        string,
        unknown
      >;
      status = exception.getStatus();
      errorCode = exception.errorCode;
      message =
        ((exceptionResponse.error as Record<string, unknown>)
          ?.message as string) ?? message;
      details = exception.details;
    }
    // 2. Handle HttpException (NestJS built-in)
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string) ?? exception.message;

        // Handle class-validator errors
        if (Array.isArray(responseObj.message)) {
          errorCode = ErrorCode.VALIDATION_ERROR;
          message = 'Validation failed';
          details = this.formatValidationErrors(responseObj.message);
        }
      } else {
        message = exception.message;
      }

      errorCode = this.mapStatusToErrorCode(status);
    } else if (
      exception &&
      typeof exception === 'object' &&
      'statusCode' in exception &&
      'errorCode' in exception
    ) {
      const backendError = exception as {
        statusCode?: number;
        message?: string;
        errorCode?: string;
      };
      status = backendError.statusCode || status;
      errorCode =
        (backendError.errorCode as ErrorCode) || (errorCode as ErrorCode);
      message = backendError.message || message;
    }
    // 4. Handle unknown errors
    else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    }

    // Standardized error response
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message,
        ...(details !== undefined && details !== null ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Log error with context
    this.logger.error(
      `${request.method} ${request.url} - [${status}] ${errorCode} - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorResponse);
  }

  /**
   * Format class-validator errors
   */
  private formatValidationErrors(
    messages: string[],
  ): Array<{ field: string; message: string }> {
    return messages.map((msg) => {
      // Try to extract field name from message
      const match = msg.match(/^(\w+)\s/);
      return {
        field: match?.[1] ?? 'unknown',
        message: msg,
      };
    });
  }

  /**
   * Map HTTP status to error code
   */
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
