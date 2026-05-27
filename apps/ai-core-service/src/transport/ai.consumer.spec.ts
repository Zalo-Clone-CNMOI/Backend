import { Test, TestingModule } from '@nestjs/testing';
import { AiConsumer } from './ai.consumer';
import { AiPublisher } from './ai.publisher';
import { AiChatPublisher } from './ai-chat.publisher';
import { ModerationEngine } from '../modules/moderation/moderation.engine';
import { SmartReplyEngine } from '../modules/smart-reply/smart-reply.engine';
import { SummaryEngine } from '../modules/summary/summary.engine';
import { TranslationEngine } from '../modules/translation/translation.engine';
import { DocumentEngine } from '../modules/document/document.engine';
import { TextExtractorService } from '../modules/document/text-extractor.service';
import { EntityDetectionEngine } from '../modules/entity-detection/entity-detection.engine';
import { ZaiChatEngine } from '../modules/zai-chat/zai-chat.engine';
import { APP_CONFIG } from '@libs/config';
import { S3Service } from '@libs/s3';
import { CacheService } from '@libs/redis';
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
    recordDocumentFailure: jest.fn(),
  };
}

function makeS3() {
  return { download: jest.fn() };
}

function makeTextExtractor() {
  return {
    extract: jest.fn((buffer: Buffer) =>
      Promise.resolve(buffer.toString('utf-8')),
    ),
  };
}

function makeEntityDetection() {
  return { detect: jest.fn(), generateInfo: jest.fn() };
}

function makeChatPublisher() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function makeZaiChatEngine() {
  return { respond: jest.fn() };
}

function makeCacheService() {
  return {
    releaseMentionCooldown: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AiConsumer', () => {
  let consumer: AiConsumer;
  let publisher: ReturnType<typeof makePublisher>;
  let chatPublisher: ReturnType<typeof makeChatPublisher>;
  let moderationEngine: ReturnType<typeof makeModeration>;
  let smartReplyEngine: ReturnType<typeof makeSmartReply>;
  let summaryEngine: ReturnType<typeof makeSummary>;
  let translationEngine: ReturnType<typeof makeTranslation>;
  let documentEngine: ReturnType<typeof makeDocument>;
  let textExtractor: ReturnType<typeof makeTextExtractor>;
  let entityDetectionEngine: ReturnType<typeof makeEntityDetection>;
  let zaiChatEngine: ReturnType<typeof makeZaiChatEngine>;
  let s3Service: ReturnType<typeof makeS3>;
  let cacheService: ReturnType<typeof makeCacheService>;

  beforeEach(async () => {
    publisher = makePublisher();
    chatPublisher = makeChatPublisher();
    moderationEngine = makeModeration();
    smartReplyEngine = makeSmartReply();
    summaryEngine = makeSummary();
    translationEngine = makeTranslation();
    documentEngine = makeDocument();
    textExtractor = makeTextExtractor();
    entityDetectionEngine = makeEntityDetection();
    zaiChatEngine = makeZaiChatEngine();
    s3Service = makeS3();
    cacheService = makeCacheService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiConsumer],
      providers: [
        { provide: AiPublisher, useValue: publisher },
        { provide: AiChatPublisher, useValue: chatPublisher },
        { provide: ModerationEngine, useValue: moderationEngine },
        { provide: SmartReplyEngine, useValue: smartReplyEngine },
        { provide: SummaryEngine, useValue: summaryEngine },
        { provide: TranslationEngine, useValue: translationEngine },
        { provide: DocumentEngine, useValue: documentEngine },
        { provide: TextExtractorService, useValue: textExtractor },
        { provide: EntityDetectionEngine, useValue: entityDetectionEngine },
        { provide: ZaiChatEngine, useValue: zaiChatEngine },
        { provide: S3Service, useValue: s3Service },
        { provide: CacheService, useValue: cacheService },
        {
          provide: APP_CONFIG,
          useValue: { aiMaxDocumentSizeMb: 10, zaiBotUserId: 'zai-bot-uuid' },
        },
      ],
    }).compile();

    consumer = module.get(AiConsumer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  describe('onSmartReplyRequest()', () => {
    it('delegates to smartReplyEngine with context_messages and emits result', async () => {
      const event: AiSmartReplyRequestEvent = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        last_message_id: 'msg-1',
        last_message_body: 'How are you?',
        context_messages: [
          { role: 'them', body: 'Hey' },
          { role: 'me', body: 'Hi' },
        ],
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

    it('records failure when S3 download fails', async () => {
      s3Service.download.mockRejectedValue(new Error('S3 unavailable'));
      const mockResult = { document_id: 'doc-1', status: 'failed' };
      documentEngine.recordDocumentFailure.mockResolvedValue(mockResult);

      await consumer.onDocumentUpload(makeUploadEvent());

      expect(documentEngine.processDocument).not.toHaveBeenCalled();
      expect(documentEngine.recordDocumentFailure).toHaveBeenCalled();
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

      expect(
        (documentEngine.processDocument.mock.calls[0] as [unknown, string])[1],
      ).toBe(content);
    });

    it('delegates PDF extraction to TextExtractorService', async () => {
      const buffer = Buffer.from('%PDF-1.4...');
      s3Service.download.mockResolvedValue(buffer);
      textExtractor.extract.mockResolvedValue('Extracted PDF body text');
      documentEngine.processDocument.mockResolvedValue({ status: 'completed' });

      await consumer.onDocumentUpload({
        ...makeUploadEvent(),
        content_type: 'application/pdf',
        file_name: 'report.pdf',
      });

      expect(textExtractor.extract).toHaveBeenCalledWith(
        buffer,
        'application/pdf',
        'report.pdf',
      );
      expect(
        (documentEngine.processDocument.mock.calls[0] as [unknown, string])[1],
      ).toBe('Extracted PDF body text');
    });

    it('records failure when extractor throws', async () => {
      s3Service.download.mockResolvedValue(Buffer.from('garbage'));
      textExtractor.extract.mockRejectedValue(
        new Error('Failed to extract pdf'),
      );
      documentEngine.recordDocumentFailure.mockResolvedValue({
        status: 'failed',
      });

      await consumer.onDocumentUpload({
        ...makeUploadEvent(),
        content_type: 'application/pdf',
        file_name: 'corrupt.pdf',
      });

      expect(documentEngine.processDocument).not.toHaveBeenCalled();
      expect(documentEngine.recordDocumentFailure).toHaveBeenCalled();
    });

    it('rejects oversized file before downloading from S3', async () => {
      const event = {
        ...makeUploadEvent(),
        file_size: 20 * 1024 * 1024, // 20 MB > 10 MB limit
      };
      const mockResult = { document_id: 'doc-1', status: 'failed' };
      documentEngine.recordDocumentFailure.mockResolvedValue(mockResult);

      await consumer.onDocumentUpload(event);

      expect(s3Service.download).not.toHaveBeenCalled();
      expect(documentEngine.recordDocumentFailure).toHaveBeenCalledWith(
        event,
        expect.stringContaining('10 MB'),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentProcessed,
        mockResult,
      );
    });
  });

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

  describe('onEntityDetectionRequest()', () => {
    it('delegates to entityDetectionEngine.detect and emits result', async () => {
      const event: AiEntityDetectionRequestEvent = {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        body: 'Tôi dùng Telegram mỗi ngày',
        created_at: Date.now(),
      };
      const mockResult = {
        message_id: 'msg-1',
        entities: [{ text: 'Telegram', type: 'tool', confidence: 0.95 }],
      };
      entityDetectionEngine.detect.mockResolvedValue(mockResult);

      await consumer.onEntityDetectionRequest(event);

      expect(entityDetectionEngine.detect).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiEntityDetectionResult,
        mockResult,
      );
    });
  });

  describe('onEntityInfoRequest()', () => {
    it('delegates to entityDetectionEngine.generateInfo and emits result', async () => {
      const event: AiEntityInfoRequestEvent = {
        entity_text: 'Telegram',
        entity_type: 'tool',
        user_id: 'user-1',
        language: 'vi',
      };
      const mockResult = {
        entity_text: 'Telegram',
        title: 'Telegram',
        summary: 'Ứng dụng nhắn tin...',
        details: '...',
      };
      entityDetectionEngine.generateInfo.mockResolvedValue(mockResult);

      await consumer.onEntityInfoRequest(event);

      expect(entityDetectionEngine.generateInfo).toHaveBeenCalledWith(event);
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiEntityInfoResult,
        mockResult,
      );
    });
  });

  // ─── Phase 4: Zai chat streaming + typing ──────────────────────────────────

  describe('onZaiChatRequest()', () => {
    const makeZaiEvent = (
      overrides: Partial<AiZaiChatRequestEvent> = {},
    ): AiZaiChatRequestEvent => ({
      message_id: 'msg-zai-1',
      conversation_id: 'conv-z',
      sender_id: 'user-z',
      body: 'hello zai',
      created_at: Date.now(),
      trace_id: 'trace-z',
      ...overrides,
    });

    it('emits typing-ON then calls engine then publishes chatMessage on success', async () => {
      const event = makeZaiEvent();
      zaiChatEngine.respond.mockResolvedValue({
        message_id: 'reply-msg-1',
        conversation_id: 'conv-z',
        body: 'hello back',
        trace_id: 'trace-z',
      });

      await consumer.onZaiChatRequest(event);

      const emitCalls = publisher.emit.mock.calls as [string, unknown][];
      const typingCalls = emitCalls.filter(
        ([topic]) => topic === KafkaTopics.AiZaiTyping,
      );
      expect(typingCalls).toHaveLength(2);
      expect(typingCalls[0][1]).toMatchObject({ is_typing: true });
      expect(typingCalls[1][1]).toMatchObject({ is_typing: false });

      expect(zaiChatEngine.respond).toHaveBeenCalled();
      expect(chatPublisher.send).toHaveBeenCalledWith(
        expect.objectContaining({ message_id: 'reply-msg-1' }),
      );
    });

    it('emits AiStreamChunk for each onChunk callback', async () => {
      const event = makeZaiEvent();
      type ZaiCb = (s: string) => Promise<void>;
      zaiChatEngine.respond.mockImplementation(
        async (_evt: AiZaiChatRequestEvent, onChunk?: ZaiCb) => {
          if (onChunk) {
            await onChunk('hello');
            await onChunk(' world');
          }
          return {
            message_id: 'reply-msg-2',
            conversation_id: 'conv-z',
            body: 'hello world',
            trace_id: 'trace-z',
          };
        },
      );

      await consumer.onZaiChatRequest(event);

      const emitCalls = publisher.emit.mock.calls as [string, unknown][];
      const chunkCalls = emitCalls.filter(
        ([topic]) => topic === KafkaTopics.AiStreamChunk,
      );
      expect(chunkCalls).toHaveLength(2);
      expect(chunkCalls[0][1]).toMatchObject({
        chunk_index: 0,
        content: 'hello',
      });
      expect(chunkCalls[1][1]).toMatchObject({
        chunk_index: 1,
        content: ' world',
      });

      // AiStreamComplete with message_id matching the reply
      const completeCalls = emitCalls.filter(
        ([topic]) => topic === KafkaTopics.AiStreamComplete,
      );
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0][1]).toMatchObject({
        total_chunks: 2,
        message_id: 'reply-msg-2',
      });
    });

    it('emits typing-OFF in finally even when engine returns null (no reply)', async () => {
      zaiChatEngine.respond.mockResolvedValue(null);

      await consumer.onZaiChatRequest(makeZaiEvent());

      const emitCalls = publisher.emit.mock.calls as [string, unknown][];
      const typingCalls = emitCalls.filter(
        ([topic]) => topic === KafkaTopics.AiZaiTyping,
      );
      expect(typingCalls[typingCalls.length - 1][1]).toMatchObject({
        is_typing: false,
      });
      expect(chatPublisher.send).not.toHaveBeenCalled();
    });

    it('emits typing-OFF in finally even when engine throws', async () => {
      zaiChatEngine.respond.mockRejectedValue(new Error('LLM down'));

      await consumer.onZaiChatRequest(makeZaiEvent());

      const emitCalls = publisher.emit.mock.calls as [string, unknown][];
      const typingCalls = emitCalls.filter(
        ([topic]) => topic === KafkaTopics.AiZaiTyping,
      );
      expect(typingCalls[typingCalls.length - 1][1]).toMatchObject({
        is_typing: false,
      });
      expect(chatPublisher.send).not.toHaveBeenCalled();
    });

    // ── Phase 5 W4: mention cooldown release on engine failure ─────────

    it('releases the mention cooldown when engine throws AND trigger=mention', async () => {
      zaiChatEngine.respond.mockRejectedValue(new Error('LLM down'));

      await consumer.onZaiChatRequest(
        makeZaiEvent({ trigger: 'mention' }),
      );

      expect(cacheService.releaseMentionCooldown).toHaveBeenCalledWith(
        'conv-z',
      );
      expect(cacheService.releaseMentionCooldown).toHaveBeenCalledTimes(1);
    });

    it('does NOT release the cooldown for trigger=conversation (conv path does not consume it)', async () => {
      zaiChatEngine.respond.mockRejectedValue(new Error('LLM down'));

      await consumer.onZaiChatRequest(
        makeZaiEvent({ trigger: 'conversation' }),
      );

      expect(cacheService.releaseMentionCooldown).not.toHaveBeenCalled();
    });

    it('does NOT release the cooldown when trigger is undefined (legacy events)', async () => {
      zaiChatEngine.respond.mockRejectedValue(new Error('LLM down'));

      await consumer.onZaiChatRequest(makeZaiEvent({ trigger: undefined }));

      expect(cacheService.releaseMentionCooldown).not.toHaveBeenCalled();
    });

    it('does NOT release the cooldown on successful reply', async () => {
      zaiChatEngine.respond.mockResolvedValue({
        message_id: 'reply-1',
        conversation_id: 'conv-z',
        body: 'ok',
        trace_id: 'trace-z',
      });

      await consumer.onZaiChatRequest(
        makeZaiEvent({ trigger: 'mention' }),
      );

      expect(cacheService.releaseMentionCooldown).not.toHaveBeenCalled();
    });
  });
});
