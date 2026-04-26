/**
 * @file ai.consumer.spec.ts
 *
 * Unit tests for AiConsumer — Kafka event consumer for all AI features.
 *
 * Each handler should:
 *  1. Delegate to the appropriate engine
 *  2. Emit the result to the correct Kafka topic via AiPublisher
 *
 * Covers: moderation, smart-reply, summary, translation,
 * document-upload, document-query handlers.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { AiConsumer } from './ai.consumer';
import { AiPublisher } from './ai.publisher';
import { ModerationEngine } from '../modules/moderation/moderation.engine';
import { SmartReplyEngine } from '../modules/smart-reply/smart-reply.engine';
import { SummaryEngine } from '../modules/summary/summary.engine';
import { TranslationEngine } from '../modules/translation/translation.engine';
import { DocumentEngine } from '../modules/document/document.engine';
import { S3Service } from '@libs/s3';
import { KafkaTopics } from '@libs/contracts';
import type {
  AiModerationRequestEvent,
  AiSmartReplyRequestEvent,
  AiSummaryRequestEvent,
  AiTranslateRequestEvent,
  AiDocumentUploadEvent,
  AiDocumentQueryEvent,
} from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePublisher() {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

function makeModeration() {
  return { moderate: jest.fn() };
}

function makeSmartReply() {
  return { generateReplies: jest.fn() };
}

function makeSummary() {
  return { summarize: jest.fn() };
}

function makeTranslation() {
  return { translate: jest.fn() };
}

function makeDocument() {
  return {
    processDocument: jest.fn(),
    queryDocument: jest.fn(),
  };
}

function makeS3() {
  return { download: jest.fn() };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AiConsumer', () => {
  let consumer: AiConsumer;
  let publisher: ReturnType<typeof makePublisher>;
  let moderationEngine: ReturnType<typeof makeModeration>;
  let smartReplyEngine: ReturnType<typeof makeSmartReply>;
  let summaryEngine: ReturnType<typeof makeSummary>;
  let translationEngine: ReturnType<typeof makeTranslation>;
  let documentEngine: ReturnType<typeof makeDocument>;
  let s3Service: ReturnType<typeof makeS3>;

  beforeEach(async () => {
    publisher = makePublisher();
    moderationEngine = makeModeration();
    smartReplyEngine = makeSmartReply();
    summaryEngine = makeSummary();
    translationEngine = makeTranslation();
    documentEngine = makeDocument();
    s3Service = makeS3();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiConsumer],
      providers: [
        { provide: AiPublisher, useValue: publisher },
        { provide: ModerationEngine, useValue: moderationEngine },
        { provide: SmartReplyEngine, useValue: smartReplyEngine },
        { provide: SummaryEngine, useValue: summaryEngine },
        { provide: TranslationEngine, useValue: translationEngine },
        { provide: DocumentEngine, useValue: documentEngine },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    consumer = module.get(AiConsumer);
  });

  // ── onModerationRequest ───────────────────────────────────────────

  describe('onModerationRequest()', () => {
    it('delegates to moderationEngine and emits result', async () => {
      const event: AiModerationRequestEvent = {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        created_at: Date.now(),
        body: 'Hello',
        requested_at: Date.now(),
      };
      const mockResult = { message_id: 'msg-1', is_flagged: false };
      moderationEngine.moderate.mockResolvedValue(mockResult);

      await consumer.onModerationRequest(event);

      expect(moderationEngine.moderate).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiModerationResult,
        mockResult,
      );
    });
  });

  // ── onSmartReplyRequest ───────────────────────────────────────────

  describe('onSmartReplyRequest()', () => {
    it('delegates to smartReplyEngine with context_messages and emits result', async () => {
      const event: AiSmartReplyRequestEvent = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        last_message_id: 'msg-1',
        last_message_body: 'How are you?',
        context_messages: [{ role: 'them', body: 'Hey' }, { role: 'me', body: 'Hi' }],
        requested_at: Date.now(),
      };
      const mockResult = { conversation_id: 'conv-1', suggestions: ['Fine!'] };
      smartReplyEngine.generateReplies.mockResolvedValue(mockResult);

      await consumer.onSmartReplyRequest(event);

      expect(smartReplyEngine.generateReplies).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiSmartReplyResult,
        mockResult,
      );
    });
  });

  // ── onSummaryRequest ──────────────────────────────────────────────

  describe('onSummaryRequest()', () => {
    it('delegates to summaryEngine with event.messages and emits result', async () => {
      const event: AiSummaryRequestEvent = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        messages: ['msg1', 'msg2', 'msg3'],
        message_ids: ['m1', 'm2', 'm3'],
        requested_at: Date.now(),
      };
      const mockResult = { conversation_id: 'conv-1', summary: 'Short chat.' };
      summaryEngine.summarize.mockResolvedValue(mockResult);

      await consumer.onSummaryRequest(event);

      expect(summaryEngine.summarize).toHaveBeenCalledWith(
        event,
        event.messages,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiSummaryResult,
        mockResult,
      );
    });
  });

  // ── onTranslateRequest ────────────────────────────────────────────

  describe('onTranslateRequest()', () => {
    it('delegates to translationEngine and emits result', async () => {
      const event: AiTranslateRequestEvent = {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        user_id: 'user-1',
        body: 'Hello',
        target_language: 'vi',
        requested_at: Date.now(),
      };
      const mockResult = { message_id: 'msg-1', translated_body: 'Xin chào' };
      translationEngine.translate.mockResolvedValue(mockResult);

      await consumer.onTranslateRequest(event);

      expect(translationEngine.translate).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiTranslateResult,
        mockResult,
      );
    });
  });

  // ── onDocumentUpload ──────────────────────────────────────────────

  describe('onDocumentUpload()', () => {
    const makeUploadEvent = (): AiDocumentUploadEvent => ({
      document_id: 'doc-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      file_key: 's3/docs/file.txt',
      file_name: 'file.txt',
      file_size: 1024,
      content_type: 'text/plain',
      uploaded_at: Date.now(),
    });

    it('downloads file from S3, processes document, emits result', async () => {
      const fileBuffer = Buffer.from('Hello world document content');
      s3Service.download.mockResolvedValue(fileBuffer);
      const mockResult = { document_id: 'doc-1', status: 'completed' };
      documentEngine.processDocument.mockResolvedValue(mockResult);

      const uploadEvent = makeUploadEvent();
      await consumer.onDocumentUpload(uploadEvent);

      expect(s3Service.download).toHaveBeenCalledWith('s3/docs/file.txt');
      expect(documentEngine.processDocument).toHaveBeenCalledWith(
        uploadEvent,
        'Hello world document content',
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentProcessed,
        mockResult,
      );
    });

    it('processes document with error text when S3 download fails', async () => {
      s3Service.download.mockRejectedValue(new Error('S3 unavailable'));
      const mockResult = { document_id: 'doc-1', status: 'failed' };
      documentEngine.processDocument.mockResolvedValue(mockResult);

      await consumer.onDocumentUpload(makeUploadEvent());

      // processDocument should still be called with error placeholder text
      const calledText = documentEngine.processDocument.mock
        .calls[0][1] as string;
      expect(calledText).toContain('[Error:');
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentProcessed,
        mockResult,
      );
    });

    it('extracts text from plain text buffer', async () => {
      const content = 'Plain text content here.';
      s3Service.download.mockResolvedValue(Buffer.from(content));
      documentEngine.processDocument.mockResolvedValue({ status: 'completed' });

      await consumer.onDocumentUpload(makeUploadEvent());

      expect(documentEngine.processDocument.mock.calls[0][1]).toBe(content);
    });

    it('returns unsupported format stub for PDF content type', async () => {
      s3Service.download.mockResolvedValue(Buffer.from('%PDF-1.4...')); // binary stub
      documentEngine.processDocument.mockResolvedValue({ status: 'failed' });

      await consumer.onDocumentUpload({
        ...makeUploadEvent(),
        content_type: 'application/pdf',
        file_name: 'report.pdf',
      });

      const calledText = documentEngine.processDocument.mock
        .calls[0][1] as string;
      expect(calledText).toContain('[Unsupported binary format');
    });
  });

  // ── onDocumentQuery ───────────────────────────────────────────────

  describe('onDocumentQuery()', () => {
    it('delegates to documentEngine.queryDocument and emits result', async () => {
      const event: AiDocumentQueryEvent = {
        document_id: 'doc-1',
        conversation_id: 'conv-1',
        user_id: 'user-1',
        query: 'What is the main topic?',
        requested_at: Date.now(),
      };
      const mockResult = {
        document_id: 'doc-1',
        answer: 'The main topic is...',
      };
      documentEngine.queryDocument.mockResolvedValue(mockResult);

      await consumer.onDocumentQuery(event);

      expect(documentEngine.queryDocument).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentQueryResult,
        mockResult,
      );
    });
  });
});
