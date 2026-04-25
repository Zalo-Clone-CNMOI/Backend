import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PollStatus } from '@app/constant';

export class PollOptionDto {
  @ApiProperty({ description: 'Option label', example: 'Pizza' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class CreatePollDto {
  @ApiProperty({
    description: 'Poll question',
    example: 'Where should we eat lunch?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @ApiProperty({
    description: 'Poll options (2..20)',
    type: [PollOptionDto],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PollOptionDto)
  options!: PollOptionDto[];

  @ApiPropertyOptional({ description: 'Allow multi-choice', default: false })
  @IsOptional()
  @IsBoolean()
  allow_multiple?: boolean;

  @ApiPropertyOptional({ description: 'Allow members to add options' })
  @IsOptional()
  @IsBoolean()
  allow_add_option?: boolean;

  @ApiPropertyOptional({ description: 'Anonymous poll (deferred in v1)' })
  @IsOptional()
  @IsBoolean()
  is_anonymous?: boolean;

  @ApiPropertyOptional({
    description: 'Auto-close after N hours (1..168)',
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  expires_in_hours?: number;
}

export class CastVoteDto {
  @ApiProperty({
    description: 'Full set of option IDs the caller is voting for',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  option_ids!: string[];
}

export class AddPollOptionDto {
  @ApiProperty({ description: 'New option label' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class EditOptionLabelDto {
  @ApiProperty({ description: 'Option ID to rename' })
  @IsUUID('4')
  option_id!: string;

  @ApiProperty({ description: 'New label for the option' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class EditPollDto {
  @ApiPropertyOptional({ description: 'New question' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question?: string;

  @ApiPropertyOptional({ description: 'Toggle multi-choice mode' })
  @IsOptional()
  @IsBoolean()
  allow_multiple?: boolean;

  @ApiPropertyOptional({ description: 'Toggle add-option permission' })
  @IsOptional()
  @IsBoolean()
  allow_add_option?: boolean;

  @ApiPropertyOptional({
    description: 'New expiry (ISO8601). Pass null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  expires_at?: string | null;

  @ApiPropertyOptional({
    description: 'Rename existing options (zero-vote options only)',
    type: [EditOptionLabelDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EditOptionLabelDto)
  edited_option_labels?: EditOptionLabelDto[];
}

export class ListPollsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: PollStatus })
  @IsOptional()
  @IsEnum(PollStatus)
  status?: PollStatus;

  @ApiPropertyOptional({ description: 'Page number (>= 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (1..50)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
