import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ZaiConversationResponseDto {
  @ApiProperty({
    description: 'UUID of the Zai AI conversation',
    format: 'uuid',
  })
  @Expose()
  conversationId!: string;
}
