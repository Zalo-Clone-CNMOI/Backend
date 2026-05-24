import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class TranslateRequestDto {
  @ApiProperty({
    description: 'Text to translate (max 5000 chars)',
    example: 'Hello, how are you?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @ApiProperty({
    description: 'Target language code or name (e.g. "en", "vi", "Japanese")',
    example: 'vi',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  target_language!: string;

  @ApiPropertyOptional({
    description:
      'Source language code or name. Omit to let the model auto-detect.',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  source_language?: string;

  @ApiProperty({
    description: 'Requesting user ID (supplied by BFF after JWT verification)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  user_id!: string;
}
