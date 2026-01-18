import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * User profile response DTO
 */
export class UserProfileResponseDto {
  @ApiProperty({
    description: 'User ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({ description: 'Phone number', example: '+84901234567' })
  phone: string;

  @ApiPropertyOptional({ description: 'Email', example: 'user@example.com' })
  email: string | null;

  @ApiProperty({ description: 'Full name', example: 'Nguyễn Văn A' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiPropertyOptional({ description: 'Bio' })
  bio: string | null;

  @ApiPropertyOptional({ description: 'Gender' })
  gender: string | null;

  @ApiPropertyOptional({ description: 'Date of birth' })
  dateOfBirth: Date | null;

  @ApiProperty({ description: 'User status', example: 'active' })
  status: string;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}

/**
 * Public user info (limited fields for other users)
 */
export class PublicUserResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Full name' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiPropertyOptional({ description: 'Bio' })
  bio: string | null;

  @ApiProperty({ description: 'User status' })
  status: string;
}

/**
 * User search result item
 */
export class UserSearchResultDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Full name' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Phone number (masked)' })
  phone: string;

  @ApiProperty({
    description: 'Friendship status with current user',
    example: 'none',
  })
  friendshipStatus:
    | 'none'
    | 'pending_sent'
    | 'pending_received'
    | 'friends'
    | 'blocked';
}
