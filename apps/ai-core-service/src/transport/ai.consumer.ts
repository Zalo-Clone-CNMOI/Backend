import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
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
} from '@libs/contracts';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { S3Service } from '@libs/s3';
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
      `Zai chat request: ${event.conversation_id} from ${event.sender_id}`,
    );
    try {
      const reply = await this.zaiChatEngine.respond(event);
      if (reply) {
        await this.chatPublisher.send(reply);
      }
    } catch (error) {
      this.logger.error(
        `Zai chat handler fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
