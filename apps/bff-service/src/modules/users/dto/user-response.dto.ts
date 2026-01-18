import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * User profile response DTO
 */
export class UserProfileResponseDto {
  @ApiPropertyOptional({
    description: 'User ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id?: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+84901234567' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Email', example: 'user@example.com' })
  email?: string | null;

  @ApiPropertyOptional({ description: 'Full name', example: 'Nguyễn Văn A' })
  fullName?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: 'Bio' })
  bio?: string | null;

  @ApiPropertyOptional({ description: 'Gender' })
  gender?: string | null;

  @ApiPropertyOptional({ description: 'Date of birth' })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ description: 'User status', example: 'active' })
  status?: string;

  @ApiPropertyOptional({ description: 'Created at' })
  createdAt?: string;
}

/**
 * Public user info (limited fields for other users)
 */
export class PublicUserResponseDto {
  @ApiPropertyOptional({ description: 'User ID' })
  id?: string;

  @ApiPropertyOptional({ description: 'Full name' })
  fullName?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: 'Bio' })
  bio?: string | null;

  @ApiPropertyOptional({ description: 'User status' })
  status?: string;
}

/**
 * User search result item
 */
export class UserSearchResultDto {
  @ApiPropertyOptional({ description: 'User ID' })
  id?: string;

  @ApiPropertyOptional({ description: 'Full name' })
  fullName?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: 'Phone number (masked)' })
  phone?: string;

  @ApiPropertyOptional({
    description: 'Friendship status with current user',
    example: 'none',
  })
  friendshipStatus?:
    | 'none'
    | 'pending_sent'
    | 'pending_received'
    | 'friends'
    | 'blocked';
}

/**
 * Paginated user search result
 */
export class PaginatedUserSearchResultDto {
  @ApiPropertyOptional({
    description: 'User search results',
    type: [UserSearchResultDto],
  })
  data?: UserSearchResultDto[];

  @ApiPropertyOptional({
    description: 'Pagination metadata',
    example: {
      total: 100,
      page: 1,
      limit: 20,
      totalPages: 5,
    },
  })
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
}
