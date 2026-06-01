import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class EntityDetectionsQueryDto {
  @ApiProperty({ description: 'UUID of the conversation' })
  @IsString()
  @IsNotEmpty()
  conversation_id: string;

  @ApiProperty({ description: 'Authenticated user ID (supplied by BFF)' })
  @IsString()
  @IsNotEmpty()
  user_id: string;
}
