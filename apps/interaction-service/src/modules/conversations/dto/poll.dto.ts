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
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { POLL_LIMITS, PollStatus } from '@app/constant';

export class PollOptionLabelDto {
  @ApiProperty({
    description: 'Option label (trimmed, non-empty)',
    example: 'Option A',
  })
  @IsString()
  @IsNotEmpty({ message: 'Option label is required' })
  @MaxLength(POLL_LIMITS.MAX_OPTION_LABEL_LENGTH, {
    message: `Option label must not exceed ${POLL_LIMITS.MAX_OPTION_LABEL_LENGTH} characters`,
  })
  label: string;
}

export class EditOptionLabelDto {
  @ApiProperty({
    description: 'Option ID to rename',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'option_id must be a valid UUID' })
  option_id: string;

  @ApiProperty({
    description: 'New label for the option',
    example: 'Updated label',
  })
  @IsString()
  @IsNotEmpty({ message: 'Option label is required' })
  @MaxLength(POLL_LIMITS.MAX_OPTION_LABEL_LENGTH, {
    message: `Option label must not exceed ${POLL_LIMITS.MAX_OPTION_LABEL_LENGTH} characters`,
  })
  label: string;
}

export class CreatePollDto {
  @ApiProperty({
    description: 'Poll question',
    example: 'Where should we eat lunch?',
  })
  @IsString()
  @IsNotEmpty({ message: 'Question is required' })
  @MaxLength(POLL_LIMITS.MAX_QUESTION_LENGTH, {
    message: `Question must not exceed ${POLL_LIMITS.MAX_QUESTION_LENGTH} characters`,
  })
  question: string;

  @ApiProperty({
    description: 'Poll options (between MIN and MAX, unique labels)',
    type: [PollOptionLabelDto],
    example: [{ label: 'Pizza' }, { label: 'Sushi' }],
  })
  @IsArray()
  @ArrayMinSize(POLL_LIMITS.MIN_OPTIONS, {
    message: `At least ${POLL_LIMITS.MIN_OPTIONS} options are required`,
  })
  @ArrayMaxSize(POLL_LIMITS.MAX_OPTIONS, {
    message: `Maximum ${POLL_LIMITS.MAX_OPTIONS} options allowed`,
  })
  @ValidateNested({ each: true })
  @Type(() => PollOptionLabelDto)
  options: PollOptionLabelDto[];

  @ApiPropertyOptional({
    description: 'Allow voters to choose multiple options',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allow_multiple?: boolean;

  @ApiPropertyOptional({
    description: 'Allow members to add new options after creation',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allow_add_option?: boolean;

  @ApiPropertyOptional({
    description:
      'Anonymous polls are deferred (v1 forces this to false in the service)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_anonymous?: boolean;

  @ApiPropertyOptional({
    description:
      'Auto-close after N hours (max 7 days). Omit/null = no expiry.',
    example: 24,
    minimum: 1,
    maximum: POLL_LIMITS.MAX_EXPIRES_IN_HOURS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'expires_in_hours must be at least 1' })
  @Max(POLL_LIMITS.MAX_EXPIRES_IN_HOURS, {
    message: `expires_in_hours must not exceed ${POLL_LIMITS.MAX_EXPIRES_IN_HOURS}`,
  })
  expires_in_hours?: number;
}

export class CastVoteDto {
  @ApiProperty({
    description: 'Full set of option IDs the caller is voting for',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one option_id is required' })
  @ArrayMaxSize(POLL_LIMITS.MAX_OPTIONS, {
    message: `option_ids cannot exceed ${POLL_LIMITS.MAX_OPTIONS} entries`,
  })
  @IsUUID('4', { each: true, message: 'Each option_id must be a valid UUID' })
  option_ids: string[];
}

export class AddPollOptionDto {
  @ApiProperty({
    description: 'New option label (trimmed, non-empty, unique within poll)',
    example: 'Vietnamese',
  })
  @IsString()
  @IsNotEmpty({ message: 'Option label is required' })
  @MinLength(1)
  @MaxLength(POLL_LIMITS.MAX_OPTION_LABEL_LENGTH, {
    message: `Option label must not exceed ${POLL_LIMITS.MAX_OPTION_LABEL_LENGTH} characters`,
  })
  label: string;
}

export class EditPollDto {
  @ApiPropertyOptional({
    description: 'New question',
    example: 'Updated question?',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(POLL_LIMITS.MAX_QUESTION_LENGTH, {
    message: `Question must not exceed ${POLL_LIMITS.MAX_QUESTION_LENGTH} characters`,
  })
  question?: string;

  @ApiPropertyOptional({
    description: 'Toggle multi-choice mode (forbidden once any vote exists)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_multiple?: boolean;

  @ApiPropertyOptional({
    description: 'Toggle whether members can add options',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_add_option?: boolean;

  @ApiPropertyOptional({
    description:
      'New ISO8601 expiry (must be in the future). Use `null` to clear.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  expires_at?: string | null;

  @ApiPropertyOptional({
    description: 'Rename existing options (each option must have zero votes)',
    type: [EditOptionLabelDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POLL_LIMITS.MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => EditOptionLabelDto)
  edited_option_labels?: EditOptionLabelDto[];
}

export class ListPollsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by poll status',
    enum: PollStatus,
    example: PollStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(PollStatus, { message: 'status must be active or closed' })
  status?: PollStatus;

  @ApiPropertyOptional({ description: 'Page number (>= 1)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Page size (1..50)',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
