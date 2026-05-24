import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { AiProviderType } from '@libs/contracts';

export class TranslateResponseDto {
  @ApiProperty({ description: 'Original text before translation' })
  @Expose()
  originalBody!: string;

  @ApiProperty({ description: 'Translated text' })
  @Expose()
  translatedBody!: string;

  @ApiProperty({ description: 'Detected or provided source language code' })
  @Expose()
  sourceLanguage!: string;

  @ApiProperty({ description: 'Target language code' })
  @Expose()
  targetLanguage!: string;

  @ApiProperty({ description: 'AI provider used', example: 'openai' })
  @Expose()
  provider!: AiProviderType;

  @ApiProperty({ description: 'True if the result was served from cache' })
  @Expose()
  cached!: boolean;
}
