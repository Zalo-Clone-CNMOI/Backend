import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class TranslateRequestDto {
  @ApiProperty({ description: 'Text to translate', maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @ApiProperty({
    description: 'Target language code (e.g. "vi", "en")',
    maxLength: 20,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  targetLanguage!: string;

  @ApiPropertyOptional({
    description: 'Source language code – omit for auto-detect',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sourceLanguage?: string;
}
