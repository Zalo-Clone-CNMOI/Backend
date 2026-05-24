import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CatchUpQueryDto {
  @ApiProperty({
    description: 'Conversation ID to summarize unread messages for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  conversation_id!: string;

  @ApiProperty({
    description: 'Requesting user ID (supplied by BFF)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  user_id!: string;

  @ApiPropertyOptional({
    description:
      'Epoch ms timestamp: only messages newer than this are considered unread. Omit if user has never read the conversation.',
    example: '1716537600000',
  })
  @IsOptional()
  @IsNumberString()
  since?: string;

  @ApiPropertyOptional({
    description:
      'Max messages to include in the summary (capped at 50 server-side)',
    example: '30',
  })
  @IsOptional()
  @IsNumberString()
  limit?: string;
}
