import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class QrGenerateDto {
  @ApiProperty({
    description: 'WebSocket socket ID of the PC client',
    example: 'abc123xyz',
  })
  @IsString()
  @IsNotEmpty({ message: 'Socket ID is required' })
  @MaxLength(100)
  socketId: string;

  @ApiPropertyOptional({
    description: 'PC device information (browser, OS)',
    example: 'Chrome 120 on Windows 11',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;
}

export class QrConfirmDto {
  @ApiProperty({
    description: 'QR session ID to confirm',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'Invalid session ID format' })
  @IsNotEmpty({ message: 'Session ID is required' })
  sessionId: string;
}

export class QrRejectDto {
  @ApiProperty({
    description: 'QR session ID to reject',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'Invalid session ID format' })
  @IsNotEmpty({ message: 'Session ID is required' })
  sessionId: string;

  @ApiPropertyOptional({
    description: 'Optional rejection reason',
    example: 'User cancelled',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
