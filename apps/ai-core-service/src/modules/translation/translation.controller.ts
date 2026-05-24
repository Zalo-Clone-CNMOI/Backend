import { randomUUID } from 'crypto';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AiTranslateResultEvent } from '@libs/contracts';
import { BusinessException } from '@app/types';
import { TranslationEngine } from './translation.engine';
import { TranslateRequestDto } from './dto/translate-request.dto';

// Internal-only endpoint — port 5005 must be firewalled from the public internet.
// user_id is caller-supplied: the BFF passes the authenticated userId after verifying the JWT.
@ApiTags('Translation')
@Controller('translate')
export class TranslationController {
  constructor(private readonly engine: TranslationEngine) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Translate text synchronously (BFF → ai-core internal)',
  })
  @ApiResponse({ status: 200, description: 'Translation result' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async translate(
    @Body() dto: TranslateRequestDto,
  ): Promise<AiTranslateResultEvent> {
    const text = dto.text?.trim();
    if (!text) {
      throw BusinessException.badRequest('text is required');
    }
    if (text.length > 5000) {
      throw BusinessException.badRequest('text exceeds 5000 characters');
    }
    if (!dto.target_language?.trim()) {
      throw BusinessException.badRequest('target_language is required');
    }
    if (!dto.user_id?.trim()) {
      throw BusinessException.badRequest('user_id is required');
    }

    return this.engine.translate({
      message_id: randomUUID(),
      conversation_id: 'http-translate',
      user_id: dto.user_id.trim(),
      body: text,
      source_language: dto.source_language,
      target_language: dto.target_language.trim(),
      requested_at: Date.now(),
    });
  }
}
