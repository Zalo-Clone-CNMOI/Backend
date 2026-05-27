import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { KafkaTopics } from '@libs/contracts';
import type {
  AiModerationRequestEvent,
  AiSmartReplyRequestEvent,
  AiSummaryRequestEvent,
  AiTranslateRequestEvent,
  AiDocumentUploadEvent,
  AiDocumentQueryEvent,
  AiEntityDetectionRequestEvent,
  AiEntityInfoRequestEvent,
  AiZaiChatRequestEvent,
  AiStreamChunkEvent,
  AiStreamCompleteEvent,
  AiZaiTypingEvent,
} from '@libs/contracts';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { S3Service } from '@libs/s3';
import { CacheService } from '@libs/redis';
import { AiPublisher } from './ai.publisher';
import { AiChatPublisher } from './ai-chat.publisher';
import { ModerationEngine } from '../modules/moderation/moderation.engine';
import { SmartReplyEngine } from '../modules/smart-reply/smart-reply.engine';
import { SummaryEngine } from '../modules/summary/summary.engine';
import { TranslationEngine } from '../modules/translation/translation.engine';
import { DocumentEngine } from '../modules/document/document.engine';
import { TextExtractorService } from '../modules/document/text-extractor.service';
import { DocumentExtractionError } from '../modules/document/document-extraction.error';
import { UnsupportedDocumentFormatError } from '../modules/document/unsupported-document-format.error';
import { EntityDetectionEngine } from '../modules/entity-detection/entity-detection.engine';
import { ZaiChatEngine } from '../modules/zai-chat/zai-chat.engine';

@Controller()
export class AiConsumer {
  private readonly logger = new Logger(AiConsumer.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly publisher: AiPublisher,
    private readonly chatPublisher: AiChatPublisher,
    private readonly moderationEngine: ModerationEngine,
    private readonly smartReplyEngine: SmartReplyEngine,
    private readonly summaryEngine: SummaryEngine,
    private readonly translationEngine: TranslationEngine,
    private readonly documentEngine: DocumentEngine,
    private readonly textExtractor: TextExtractorService,
    private readonly entityDetectionEngine: EntityDetectionEngine,
    private readonly zaiChatEngine: ZaiChatEngine,
    private readonly s3Service: S3Service,
    private readonly cacheService: CacheService,
  ) {}

  // ── Moderation ─────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiModerationRequest)
  async onModerationRequest(@Payload() event: AiModerationRequestEvent) {
    this.logger.log(`Moderation request for message: ${event.message_id}`);
    try {
      const result = await this.moderationEngine.moderate(event);
      await this.publisher.emit(KafkaTopics.AiModerationResult, result);
    } catch (error) {
      this.logger.error(
        `Moderation handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Smart Reply ────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiSmartReplyRequest)
  async onSmartReplyRequest(@Payload() event: AiSmartReplyRequestEvent) {
    this.logger.log(
      `Smart reply request for conversation: ${event.conversation_id} (${event.context_messages.length} context msgs)`,
    );
    try {
      const result = await this.smartReplyEngine.generateReplies(event);
      await this.publisher.emit(KafkaTopics.AiSmartReplyResult, result);
    } catch (error) {
      this.logger.error(
        `Smart reply handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Summary ────────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiSummaryRequest)
  async onSummaryRequest(@Payload() event: AiSummaryRequestEvent) {
    this.logger.log(
      `Summary request for conversation: ${event.conversation_id} (${event.messages.length} msgs)`,
    );
    try {
      const MAX_MESSAGES = 200;
      const safeMessages =
        event.messages.length > MAX_MESSAGES
          ? event.messages.slice(0, MAX_MESSAGES)
          : event.messages;
      if (event.messages.length > MAX_MESSAGES) {
        this.logger.warn(
          `Summary request for ${event.conversation_id} truncated from ${event.messages.length} to ${MAX_MESSAGES} messages`,
        );
      }
      const result = await this.summaryEngine.summarize(event, safeMessages);
      await this.publisher.emit(KafkaTopics.AiSummaryResult, result);
    } catch (error) {
      this.logger.error(
        `Summary handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Translation ────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiTranslateRequest)
  async onTranslateRequest(@Payload() event: AiTranslateRequestEvent) {
    this.logger.log(
      `Translate request: ${event.message_id} → ${event.target_language}`,
    );
    try {
      const result = await this.translationEngine.translate(event);
      await this.publisher.emit(KafkaTopics.AiTranslateResult, result);
    } catch (error) {
      this.logger.error(
        `Translation handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Document Upload ────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiDocumentUpload)
  async onDocumentUpload(@Payload() event: AiDocumentUploadEvent) {
    this.logger.log(
      `Document upload: ${event.document_id} (${event.file_name})`,
    );

    const limitMb = this.config.aiMaxDocumentSizeMb ?? 10;
    const maxSizeBytes = limitMb * 1024 * 1024;
    if (event.file_size > maxSizeBytes) {
      this.logger.warn(
        `Document ${event.document_id} rejected before download: ${event.file_size} bytes exceeds ${limitMb} MB limit`,
      );
      try {
        const result = await this.documentEngine.recordDocumentFailure(
          event,
          `File exceeds maximum size of ${limitMb} MB`,
        );
        await this.publisher.emit(KafkaTopics.AiDocumentProcessed, result);
      } catch (guardError) {
        this.logger.error(
          `Failed to record oversized-file rejection for ${event.document_id}: ${guardError instanceof Error ? guardError.message : String(guardError)}`,
        );
      }
      return;
    }

    try {
      const buffer = await this.s3Service.download(event.file_key);
      const textContent = await this.textExtractor.extract(
        buffer,
        event.content_type,
        event.file_name,
      );

      this.logger.debug(
        `Extracted ${textContent.length} chars from ${event.file_name}`,
      );
      const result = await this.documentEngine.processDocument(
        event,
        textContent,
      );

      await this.publisher.emit(KafkaTopics.AiDocumentProcessed, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isExtractionFailure =
        error instanceof UnsupportedDocumentFormatError ||
        error instanceof DocumentExtractionError;

      if (isExtractionFailure) {
        this.logger.warn(
          `Unsupported or failed extraction for ${event.document_id}: ${message}`,
        );
      } else {
        this.logger.error(
          `Failed to download/extract document ${event.document_id}: ${message}`,
        );
      }

      const result = await this.documentEngine.recordDocumentFailure(
        event,
        message,
      );
      await this.publisher.emit(KafkaTopics.AiDocumentProcessed, result);
    }
  }

  // ── Document Query ─────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiDocumentQuery)
  async onDocumentQuery(@Payload() event: AiDocumentQueryEvent) {
    this.logger.log(`Document query: ${event.document_id} — "${event.query}"`);
    try {
      const result = await this.documentEngine.queryDocument(event);
      await this.publisher.emit(KafkaTopics.AiDocumentQueryResult, result);
    } catch (error) {
      this.logger.error(
        `Document query handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Entity Detection ───────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiEntityDetectionRequest)
  async onEntityDetectionRequest(
    @Payload() event: AiEntityDetectionRequestEvent,
  ) {
    this.logger.log(
      `Entity detection request for message: ${event.message_id}`,
    );
    try {
      const result = await this.entityDetectionEngine.detect(event);
      await this.publisher.emit(KafkaTopics.AiEntityDetectionResult, result);
    } catch (error) {
      this.logger.error(
        `Entity detection handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @EventPattern(KafkaTopics.AiEntityInfoRequest)
  async onEntityInfoRequest(@Payload() event: AiEntityInfoRequestEvent) {
    this.logger.log(
      `Entity info request: "${event.entity_text}" (${event.entity_type})`,
    );
    try {
      const result = await this.entityDetectionEngine.generateInfo(event);
      await this.publisher.emit(KafkaTopics.AiEntityInfoResult, result);
    } catch (error) {
      this.logger.error(
        `Entity info handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Zai Chat ───────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiZaiChatRequest)
  async onZaiChatRequest(@Payload() event: AiZaiChatRequestEvent) {
    this.logger.log(
      `Zai chat request: ${event.conversation_id} from ${event.sender_id} (trigger: ${event.trigger ?? 'conversation'})`,
    );

    const streamId = randomUUID();
    const userId = event.sender_id;
    let chunkIndex = 0;
    let typingOffEmitted = false;

    const emitTypingOff = async () => {
      if (typingOffEmitted) return;
      typingOffEmitted = true;
      try {
        const payload: AiZaiTypingEvent = {
          conversation_id: event.conversation_id,
          is_typing: false,
          user_id: userId,
          trace_id: event.trace_id,
        };
        await this.publisher.emit(KafkaTopics.AiZaiTyping, payload);
      } catch (err) {
        this.logger.warn(
          `Failed to emit typing-OFF for ${event.conversation_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    try {
      // Typing-ON
      const typingOnPayload: AiZaiTypingEvent = {
        conversation_id: event.conversation_id,
        is_typing: true,
        user_id: userId,
        trace_id: event.trace_id,
      };
      await this.publisher.emit(KafkaTopics.AiZaiTyping, typingOnPayload);

      const onChunk = async (content: string) => {
        await emitTypingOff();
        const index = chunkIndex++;
        const chunkPayload: AiStreamChunkEvent = {
          stream_id: streamId,
          user_id: userId,
          conversation_id: event.conversation_id,
          feature: 'zai_chat',
          chunk_index: index,
          content,
          is_final: false,
          trace_id: event.trace_id,
        };
        // Key by streamId so all chunks of one stream land on the same
        // Kafka partition → ordered delivery under a multi-instance
        // ws-gateway (Phase 6 W6).
        await this.publisher.emit(
          KafkaTopics.AiStreamChunk,
          chunkPayload,
          streamId,
        );
      };

      const result = await this.zaiChatEngine.respond(event, onChunk);

      if (result) {
        const { reply, provider, tokensIn, tokensOut } = result;
        const completePayload: AiStreamCompleteEvent = {
          stream_id: streamId,
          user_id: userId,
          conversation_id: event.conversation_id,
          feature: 'zai_chat',
          total_chunks: chunkIndex,
          total_tokens: tokensIn + tokensOut,
          provider,
          completed_at: Date.now(),
          message_id: reply.message_id,
          trace_id: event.trace_id,
        };
        await this.publisher.emit(
          KafkaTopics.AiStreamComplete,
          completePayload,
          streamId,
        );

        await this.chatPublisher.send(reply);
      }
    } catch (error) {
      this.logger.error(
        `Zai chat handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Release the 5s mention cooldown so the user can retry immediately
      // (Phase 5 audit W4). Only the 'mention' trigger consumes the
      // cooldown — the 'conversation' trigger (auto-reply on every
      // message in an AI_ASSISTANT conv) does NOT, so we must NOT release
      // there or we would clear a cooldown that did not belong to us.
      if (event.trigger === 'mention') {
        await this.cacheService
          .releaseMentionCooldown(event.conversation_id)
          .catch((e: unknown) =>
            this.logger.warn(
              `[${event.trace_id}] Failed to release mention cooldown: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
    } finally {
      await emitTypingOff();
    }
  }
}
