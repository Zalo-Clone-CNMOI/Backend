import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Synchronous pre-send moderation check request from chat-service.
 * Internal endpoint — no auth; protected by k8s NetworkPolicy.
 */
export class PreSendModerationCheckDto {
  @ApiProperty({
    description: 'Message body to moderate (text only).',
    example: 'Hello team, ready for the meeting?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @ApiProperty({
    description: 'UUID of the user attempting to send the message.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  sender_id!: string;

  @ApiPropertyOptional({
    description:
      'UUID of the target conversation. Optional — included for audit logs.',
    example: '660e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID('4')
  conversation_id?: string;
}
