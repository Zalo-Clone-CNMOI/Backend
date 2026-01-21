import { Logger } from '@nestjs/common';
import { AxiosError } from 'axios';

/**
 * Base HTTP Client
 * Provides common error handling for all HTTP client services
 */
export abstract class BaseHttpClient {
  protected abstract readonly logger: Logger;
  protected handleError(method: string, error: unknown): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status || 500;
      const errorData = error.response?.data as {
        success?: boolean;
        error?: {
          code?: string;
          message?: string;
          details?: unknown;
        };
        message?: string;
        [key: string]: unknown;
      };

      // Backend response format: { error: { code: "...", message: "..." } }
      const message =
        errorData?.error?.message ||
        errorData?.message ||
        error.message ||
        'Unknown error';
      const errorCode = errorData?.error?.code || 'INTERNAL_SERVER_ERROR';

      this.logger.error(
        `${this.constructor.name}.${method} failed: [${status}] ${errorCode} - ${message}`,
      );

      // Re-throw with backend error structure
      const structuredError = new Error(message);
      Object.assign(structuredError, {
        statusCode: status,
        message: message,
        errorCode: errorCode,
        timestamp: new Date().toISOString(),
      });
      throw structuredError;
    }

    // Handle non-Axios errors
    this.logger.error(
      `${this.constructor.name}.${method} unexpected error:`,
      error,
    );
    const genericError = new Error('Internal server error');
    Object.assign(genericError, {
      statusCode: 500,
      message: 'Internal server error',
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
    });
    throw genericError;
  }
}
