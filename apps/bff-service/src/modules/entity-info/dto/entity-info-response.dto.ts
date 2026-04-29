import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { EntityType, AiProviderType } from '@libs/contracts';

export class EntityInfoResponseDto {
  @ApiProperty({ description: 'Entity text', example: 'React' })
  @Expose()
  entity_text!: string;

  @ApiProperty({ description: 'Entity type', example: 'tool' })
  @Expose()
  entity_type!: EntityType;

  @ApiProperty({ description: 'Title', example: 'React' })
  @Expose()
  title!: string;

  @ApiProperty({ description: 'Summary' })
  @Expose()
  summary!: string;

  @ApiProperty({ description: 'Details' })
  @Expose()
  details!: string;

  @ApiPropertyOptional({ description: 'Related entities' })
  @Expose()
  related_entities?: string[];

  @ApiProperty({ description: 'AI provider', example: 'openai' })
  @Expose()
  provider!: AiProviderType;

  @ApiProperty({ description: 'Tokens used', example: 120 })
  @Expose()
  tokens_used!: number;

  @ApiProperty({ description: 'Processed timestamp (epoch ms)' })
  @Expose()
  processed_at!: number;
}
