import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { AiProviderType } from '@libs/contracts';

export class CatchUpResponseDto {
  @ApiProperty({
    description:
      'True when the user had unread messages and a summary was produced',
  })
  @Expose()
  hadUnread!: boolean;

  @ApiProperty({
    description:
      'Natural-language summary of unread messages (empty when hadUnread is false)',
  })
  @Expose()
  summary!: string;

  @ApiProperty({
    description: 'Number of unread messages that were summarized',
  })
  @Expose()
  messageCount!: number;

  @ApiPropertyOptional({
    description: 'ID of the oldest message included in the summary',
  })
  @Expose()
  fromMessageId?: string;

  @ApiPropertyOptional({
    description: 'ID of the newest message included in the summary',
  })
  @Expose()
  toMessageId?: string;

  @ApiProperty({
    description:
      'True when the unread window was truncated due to the message cap',
  })
  @Expose()
  truncated!: boolean;

  @ApiProperty({ description: 'AI provider used', example: 'openai' })
  @Expose()
  provider!: AiProviderType;

  @ApiProperty({ description: 'True if the result was served from cache' })
  @Expose()
  cached!: boolean;

  @ApiProperty({ description: 'Epoch ms when this summary was generated' })
  @Expose()
  generatedAt!: number;
}
