import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * User response DTO
 */
export class UserResponseDto {
  @ApiPropertyOptional({
    description: 'User ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id?: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+84901234567' })
  phone?: string;

  @ApiPropertyOptional({
    description: 'Email',
    example: 'user@example.com',
  })
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
 * Token response DTO
 */
export class TokensResponseDto {
  @ApiPropertyOptional({ description: 'Access token' })
  accessToken?: string;

  @ApiPropertyOptional({ description: 'Refresh token' })
  refreshToken?: string;

  @ApiPropertyOptional({
    description: 'Token expiration time in seconds',
    example: 900,
  })
  expiresIn?: number;
}

/**
 * Auth response (user + tokens)
 */
export class AuthResponseDto {
  @ApiPropertyOptional({
    description: 'User information',
    type: UserResponseDto,
  })
  user?: UserResponseDto;

  @ApiPropertyOptional({ description: 'Token pair', type: TokensResponseDto })
  tokens?: TokensResponseDto;
}

/**
 * Refresh token response
 */
export class RefreshTokenResponseDto {
  @ApiPropertyOptional({ description: 'New access token' })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'Token expiration time in seconds',
    example: 900,
  })
  expiresIn?: number;
}
