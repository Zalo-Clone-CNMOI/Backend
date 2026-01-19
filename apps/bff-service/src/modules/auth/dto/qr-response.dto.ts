import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QrSessionResponseDto {
  @ApiProperty({
    description: 'Unique session ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId?: string;

  @ApiProperty({
    description: 'Token to be encoded in QR code',
    example: 'qr_abc123xyz789',
  })
  qrToken?: string;

  @ApiProperty({
    description: 'Session expiration time',
    example: '2026-01-18T15:00:00.000Z',
  })
  expiresAt?: string;

  @ApiProperty({
    description: 'Seconds until expiration',
    example: 300,
  })
  expiresInSeconds?: number;
}

export class QrStatusResponseDto {
  @ApiProperty({
    description: 'Session ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId?: string;

  @ApiProperty({
    description: 'Current session status',
    enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED'],
    example: 'PENDING',
  })
  status?: string;

  @ApiPropertyOptional({
    description: 'Access token (only present when status is CONFIRMED)',
  })
  accessToken?: string | null;

  @ApiPropertyOptional({
    description: 'Refresh token (only present when status is CONFIRMED)',
  })
  refreshToken?: string | null;

  @ApiPropertyOptional({
    description:
      'Token expiration in seconds (only present when status is CONFIRMED)',
    example: 900,
  })
  expiresIn?: number | null;

  @ApiPropertyOptional({
    description: 'User info (only present when status is CONFIRMED)',
  })
  user?: Record<string, unknown> | null;
}
