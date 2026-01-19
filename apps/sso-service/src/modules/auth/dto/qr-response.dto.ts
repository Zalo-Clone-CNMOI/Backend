import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from './auth-response.dto';

export enum QrSessionStatusEnum {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export class QrSessionResponseDto {
  @ApiProperty({
    description: 'Unique session ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Token to be encoded in QR code',
    example: 'qr_abc123xyz789',
  })
  qrToken: string;

  @ApiProperty({
    description: 'Session expiration time',
    example: '2026-01-18T15:00:00.000Z',
  })
  expiresAt: Date;

  @ApiProperty({
    description: 'Seconds until expiration',
    example: 300,
  })
  expiresInSeconds: number;
}

export class QrStatusResponseDto {
  @ApiProperty({
    description: 'Session ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Current session status',
    enum: QrSessionStatusEnum,
    example: QrSessionStatusEnum.PENDING,
  })
  status: QrSessionStatusEnum;

  @ApiPropertyOptional({
    description: 'Access token (only present when status is CONFIRMED)',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'Refresh token (only present when status is CONFIRMED)',
  })
  refreshToken?: string;

  @ApiPropertyOptional({
    description:
      'Token expiration in seconds (only present when status is CONFIRMED)',
    example: 900,
  })
  expiresIn?: number;

  @ApiPropertyOptional({
    description: 'User info (only present when status is CONFIRMED)',
    type: () => UserResponseDto,
  })
  user?: UserResponseDto;
}
