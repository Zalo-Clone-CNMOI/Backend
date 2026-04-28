import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const ENTITY_TYPES = [
  'tool',
  'company',
  'person',
  'concept',
  'location',
  'product',
  'other',
] as const;

export class EntityInfoQueryDto {
  @ApiProperty({
    description: 'Entity text (max 200 chars)',
    example: 'React',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text!: string;

  @ApiProperty({
    description: 'Entity type',
    example: 'tool',
  })
  @IsString()
  @IsIn(ENTITY_TYPES)
  type!: string;

  @ApiPropertyOptional({
    description: 'Output language (default: vi)',
    enum: ['vi', 'en'],
  })
  @IsOptional()
  @IsIn(['vi', 'en'])
  lang?: string;

  @ApiPropertyOptional({
    description: 'Requesting user ID',
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;
}
