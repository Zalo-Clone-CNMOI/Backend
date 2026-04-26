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
} from '@libs/contracts';
import { S3Service } from '@libs/s3';
import { AiPublisher } from './ai.publisher';
import { ModerationEngine } from '../modules/moderation/moderation.engine';
import { SmartReplyEngine } from '../modules/smart-reply/smart-reply.engine';
import { SummaryEngine } from '../modules/summary/summary.engine';
import { TranslationEngine } from '../modules/translation/translation.engine';
import { DocumentEngine } from '../modules/document/document.engine';

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

  /** MIME types we can extract text from directly (UTF-8 decode). */
  private static readonly TEXT_MIME_TYPES = new Set([
    'text/plain',
    'text/csv',
    'text/markdown',
  ]);

  @EventPattern(KafkaTopics.AiDocumentUpload)
  async onDocumentUpload(@Payload() event: AiDocumentUploadEvent) {
    this.logger.log(
      `Document upload: ${event.document_id} (${event.file_name})`,
    );

    let textContent: string;

    try {
      const buffer = await this.s3Service.download(event.file_key);
      textContent = this.extractText(buffer, event.content_type);

      this.logger.debug(
        `Extracted ${textContent.length} chars from ${event.file_name}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to download/extract document ${event.document_id}: ${error}`,
      );
      textContent = `[Error: Could not extract text from ${event.file_name}]`;
    }

    const result = await this.documentEngine.processDocument(
      event,
      textContent,
    );

    await this.publisher.emit(KafkaTopics.AiDocumentProcessed, result);
  }

  /**
   * Extract plain text from a downloaded S3 buffer based on its MIME type.
   *
   * Currently supports text-based formats (plain, csv, markdown).
   * Binary formats (PDF, DOCX, XLSX) return a stub message —
   * integrate a parser library (e.g. pdf-parse, mammoth) when needed.
   */
  private extractText(buffer: Buffer, contentType: string): string {
    if (AiConsumer.TEXT_MIME_TYPES.has(contentType)) {
      return buffer.toString('utf-8');
    }
    if (
      contentType === 'application/pdf' ||
      contentType === 'application/msword' ||
      contentType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      contentType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return `[Unsupported binary format: ${contentType}. Text extraction not yet implemented.]`;
    }

    return buffer.toString('utf-8');
  }

  // ── Document Query ─────────────────────────────────────────────────

  @EventPattern(KafkaTopics.AiDocumentQuery)
  async onDocumentQuery(@Payload() event: AiDocumentQueryEvent) {
    this.logger.log(`Document query: ${event.document_id} — "${event.query}"`);

    const result = await this.documentEngine.queryDocument(event);

    await this.publisher.emit(KafkaTopics.AiDocumentQueryResult, result);
  }
}
