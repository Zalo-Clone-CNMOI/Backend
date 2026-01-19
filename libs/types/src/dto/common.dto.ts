import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsPositive, Max, IsString } from 'class-validator';

/**
 * Pagination query parameters (offset-based)
 */
export class PaginationQuery {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(100)
  limit?: number = 20;
}

/**
 * Cursor-based pagination query
 */
export class CursorPaginationQuery {
  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Cursor for pagination (base64 encoded)',
    example: 'eyJpZCI6IjEyMzQ1In0=',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * Pagination metadata (offset-based)
 */
export class PaginationMeta {
  @ApiProperty({ description: 'Total number of items', example: 100 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNext: boolean;

  @ApiProperty({
    description: 'Whether there is a previous page',
    example: false,
  })
  hasPrev: boolean;
}

/**
 * Cursor pagination metadata
 */
export class CursorPaginationMeta {
  @ApiProperty({ description: 'Items per page', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Whether there are more items', example: true })
  hasMore: boolean;

  @ApiPropertyOptional({
    description: 'Cursor for next page',
    example: 'eyJpZCI6IjEyMzQ1In0=',
  })
  nextCursor: string | null;

  @ApiPropertyOptional({ description: 'Total count (if available)' })
  total?: number;
}

/**
 * Paginated response wrapper (offset-based)
 */
export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

/**
 * Cursor-paginated response wrapper
 */
export interface CursorPaginatedResponse<T> {
  items: T[];
  meta: CursorPaginationMeta;
}

/**
 * Standard API response
 */
export class ApiResponse<T> {
  @ApiProperty({ description: 'Request success status', example: true })
  success: boolean;

  @ApiProperty({ description: 'Response data' })
  data: T;

  @ApiProperty({ description: 'Response timestamp' })
  timestamp: string;
}

/**
 * Error detail
 */
export class ErrorDetail {
  @ApiProperty({ description: 'Field name', example: 'phone' })
  field: string;

  @ApiProperty({ description: 'Error message', example: 'Phone is required' })
  message: string;
}

/**
 * Error response
 */
export class ErrorResponse {
  @ApiProperty({ description: 'Request success status', example: false })
  success: boolean;

  @ApiProperty({
    description: 'Error information',
    example: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [{ field: 'phone', message: 'Phone is required' }],
    },
  })
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };

  @ApiProperty({ description: 'Response timestamp' })
  timestamp: string;
}

/**
 * Message response (for simple success messages)
 */
export class MessageResponse {
  @ApiProperty({
    description: 'Success message',
    example: 'Operation completed successfully',
  })
  message: string;
}
