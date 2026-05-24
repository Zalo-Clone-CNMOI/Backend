import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AiCoreClientService } from '@app/clients';
import { InteractionClientService } from '@app/clients/interaction-client';
import { CatchUpResponseDto } from './dto/catch-up-response.dto';
import { TranslateResponseDto } from './dto/translate-response.dto';
import type { TranslateRequestDto } from './dto/translate-request.dto';

@Injectable()
export class AiAssistService {
  constructor(
    private readonly interactionClient: InteractionClientService,
    private readonly aiCoreClient: AiCoreClientService,
  ) {}

  /**
   * Fetch a "catch-up" summary of unread messages in a conversation for the
   * calling user.
   *
   * The call to `interactionClient.getConversationById` acts as the membership
   * gate: if the user is not a member the client throws a 403/404 which the
   * BFF global exception filter maps to the appropriate HTTP status code.
   *
   * The response carries the caller's own `mySettings.lastReadAt`, which bounds
   * the unread window passed to ai-core as `since`. The generated
   * `ConversationDetailDto` type is stale and omits `mySettings`, so we read it
   * through a narrow cast; regenerating the interaction client would make this
   * type-safe (see PR follow-up).
   */
  async catchUp(
    token: string,
    userId: string,
    conversationId: string,
  ): Promise<CatchUpResponseDto> {
    // Membership enforcement – throws if not a member.
    const detail = await this.interactionClient.getConversationById(
      token,
      conversationId,
    );

    const lastReadAt = (
      detail as { mySettings?: { lastReadAt?: string | Date | null } }
    ).mySettings?.lastReadAt;
    const since = lastReadAt ? new Date(lastReadAt).getTime() : undefined;

    const result = await this.aiCoreClient.getCatchUpSummary({
      conversationId,
      userId,
      since,
    });

    const mapped = {
      hadUnread: result.had_unread,
      summary: result.summary,
      messageCount: result.message_count,
      fromMessageId: result.from_message_id,
      toMessageId: result.to_message_id,
      truncated: result.truncated,
      provider: result.provider,
      cached: result.cached,
      generatedAt: result.generated_at,
    };

    return plainToInstance(CatchUpResponseDto, mapped, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Translate a piece of text to the requested language.  This is a private,
   * per-user call; the result is never posted into any conversation.
   */
  async translate(
    userId: string,
    dto: TranslateRequestDto,
  ): Promise<TranslateResponseDto> {
    const result = await this.aiCoreClient.translate({
      text: dto.text,
      targetLanguage: dto.targetLanguage,
      sourceLanguage: dto.sourceLanguage,
      userId,
    });

    const mapped = {
      originalBody: result.original_body,
      translatedBody: result.translated_body,
      sourceLanguage: result.source_language,
      targetLanguage: result.target_language,
      provider: result.provider,
      cached: result.cached,
    };

    return plainToInstance(TranslateResponseDto, mapped, {
      excludeExtraneousValues: true,
    });
  }
}
