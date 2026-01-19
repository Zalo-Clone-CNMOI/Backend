import { ApiProperty } from '@nestjs/swagger';

/**
 * User response DTO
 */
export class UserResponseDto {
  @ApiProperty({
    description: 'User ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({ description: 'Phone number', example: '+84901234567' })
  phone: string;

  @ApiProperty({
    description: 'Email',
    example: 'user@example.com',
    nullable: true,
  })
  email: string | null;

  @ApiProperty({ description: 'Full name', example: 'Nguyễn Văn A' })
  fullName: string;

  @ApiProperty({ description: 'Avatar URL', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Bio', nullable: true })
  bio: string | null;

  @ApiProperty({ description: 'Gender', nullable: true })
  gender: string | null;

  @ApiProperty({ description: 'Date of birth', nullable: true })
  dateOfBirth: Date | null;

  @ApiProperty({ description: 'User status', example: 'active' })
  status: string;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}

/**
 * Token response DTO
 */
export class TokensResponseDto {
  @ApiProperty({ description: 'Access token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh token' })
  refreshToken: string;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 900,
  })
  expiresIn: number;
}

/**
 * Auth response (user + tokens)
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'User information', type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ description: 'Token pair', type: TokensResponseDto })
  tokens: TokensResponseDto;
}

/**
 * Refresh token response
 */
export class RefreshTokenResponseDto {
  @ApiProperty({ description: 'New access token' })
  accessToken: string;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 900,
  })
  expiresIn: number;
}
