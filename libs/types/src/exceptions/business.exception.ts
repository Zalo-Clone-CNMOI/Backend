import { HttpException } from '@nestjs/common';
import { ErrorCode, ErrorMessage, ErrorHttpStatus } from '@app/constant';

/**
 * Custom business exception
 * Used to throw business logic errors with proper error codes
 */
export class BusinessException extends HttpException {
  public readonly errorCode: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    errorCode: ErrorCode,
    customMessage?: string,
    details?: Record<string, unknown>,
  ) {
    const message = customMessage ?? ErrorMessage[errorCode];
    const status = ErrorHttpStatus[errorCode];

    super(
      {
        success: false,
        error: {
          code: errorCode,
          message,
          details,
        },
        timestamp: new Date().toISOString(),
      },
      status,
    );

    this.errorCode = errorCode;
    this.details = details;
  }

  /**
   * Factory method for common errors
   */
  static notFound(resource: string): BusinessException {
    return new BusinessException(ErrorCode.NOT_FOUND, `${resource} not found.`);
  }

  static unauthorized(message?: string): BusinessException {
    return new BusinessException(ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message?: string): BusinessException {
    return new BusinessException(ErrorCode.FORBIDDEN, message);
  }

  static badRequest(message?: string): BusinessException {
    return new BusinessException(ErrorCode.BAD_REQUEST, message);
  }

  static conflict(message?: string): BusinessException {
    return new BusinessException(ErrorCode.CONFLICT, message);
  }

  static internal(message?: string): BusinessException {
    return new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR, message);
  }
}
