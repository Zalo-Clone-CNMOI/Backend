import { Controller, Logger } from '@nestjs/common';
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
} from '@libs/contracts';
import { S3Service } from '@libs/s3';
import { AiPublisher } from './ai.publisher';
import { ModerationEngine } from '../modules/moderation/moderation.engine';
import { SmartReplyEngine } from '../modules/smart-reply/smart-reply.engine';
import { SummaryEngine } from '../modules/summary/summary.engine';
import { TranslationEngine } from '../modules/translation/translation.engine';
import { DocumentEngine } from '../modules/document/document.engine';
import {
  TextExtractorService,
  UnsupportedDocumentFormatError,
  DocumentExtractionError,
} from '../modules/document/text-extractor.service';
import { EntityDetectionEngine } from '../modules/entity-detection/entity-detection.engine';

@Controller()
export class AiConsumer {
  private readonly logger = new Logger(AiConsumer.name);

  constructor(
    private readonly publisher: AiPublisher,
    private readonly moderationEngine: ModerationEngine,
    private readonly smartReplyEngine: SmartReplyEngine,
    private readonly summaryEngine: SummaryEngine,
    private readonly translationEngine: TranslationEngine,
    private readonly documentEngine: DocumentEngine,
    private readonly textExtractor: TextExtractorService,
    private readonly entityDetectionEngine: EntityDetectionEngine,
    private readonly s3Service: S3Service,
  ) {}

  // ── Moderation ─────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiModerationRequest)
  async onModerationRequest(@Payload() event: AiModerationRequestEvent) {
    this.logger.log(`Moderation request for message: ${event.message_id}`);

    const result = await this.moderationEngine.moderate(event);

    await this.publisher.emit(KafkaTopics.AiModerationResult, result);
  }

  // ── Smart Reply ────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiSmartReplyRequest)
  async onSmartReplyRequest(@Payload() event: AiSmartReplyRequestEvent) {
    this.logger.log(
      `Smart reply request for conversation: ${event.conversation_id} (${event.context_messages.length} context msgs)`,
    );

    const result = await this.smartReplyEngine.generateReplies(event);

    await this.publisher.emit(KafkaTopics.AiSmartReplyResult, result);
  }

  // ── Summary ────────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiSummaryRequest)
  async onSummaryRequest(@Payload() event: AiSummaryRequestEvent) {
    this.logger.log(
      `Summary request for conversation: ${event.conversation_id} (${event.messages.length} msgs)`,
    );

    const result = await this.summaryEngine.summarize(event, event.messages);

    await this.publisher.emit(KafkaTopics.AiSummaryResult, result);
  }

  // ── Translation ────────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiTranslateRequest)
  async onTranslateRequest(@Payload() event: AiTranslateRequestEvent) {
    this.logger.log(
      `Translate request: ${event.message_id} → ${event.target_language}`,
    );

    const result = await this.translationEngine.translate(event);

    await this.publisher.emit(KafkaTopics.AiTranslateResult, result);
  }

  // ── Document Upload ────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiDocumentUpload)
  async onDocumentUpload(@Payload() event: AiDocumentUploadEvent) {
    this.logger.log(
      `Document upload: ${event.document_id} (${event.file_name})`,
    );

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

    const result = await this.documentEngine.queryDocument(event);

    await this.publisher.emit(KafkaTopics.AiDocumentQueryResult, result);
  }

  // ── Entity Detection ───────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiEntityDetectionRequest)
  async onEntityDetectionRequest(
    @Payload() event: AiEntityDetectionRequestEvent,
  ) {
    this.logger.log(
      `Entity detection request for message: ${event.message_id}`,
    );

    const result = await this.entityDetectionEngine.detect(event);

    await this.publisher.emit(KafkaTopics.AiEntityDetectionResult, result);
  }

  @EventPattern(KafkaTopics.AiEntityInfoRequest)
  async onEntityInfoRequest(@Payload() event: AiEntityInfoRequestEvent) {
    this.logger.log(
      `Entity info request: "${event.entity_text}" (${event.entity_type})`,
    );

    const result = await this.entityDetectionEngine.generateInfo(event);

    await this.publisher.emit(KafkaTopics.AiEntityInfoResult, result);
  }
}
