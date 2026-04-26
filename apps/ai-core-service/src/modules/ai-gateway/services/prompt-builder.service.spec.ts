/**
 * @file prompt-builder.service.spec.ts
 *
 * Unit tests for PromptBuilderService — validates that each builder
 * returns correctly structured LlmChatMessage arrays with the
 * expected roles and content shape.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PromptBuilderService } from './prompt-builder.service';

describe('PromptBuilderService', () => {
  let builder: PromptBuilderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptBuilderService],
    }).compile();

    builder = module.get(PromptBuilderService);
  });

  // ── buildModerationPrompt ─────────────────────────────────────────

  describe('buildModerationPrompt', () => {
    it('returns exactly 2 messages: system + user', () => {
      const result = builder.buildModerationPrompt('Hello world');
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('puts the message body as user content', () => {
      const body = 'You are a terrible person!';
      const result = builder.buildModerationPrompt(body);
      expect(result[1].content).toBe(body);
    });

    it('system prompt mentions JSON response format', () => {
      const result = builder.buildModerationPrompt('test');
      expect(result[0].content).toContain('JSON');
      expect(result[0].content).toContain('is_flagged');
      expect(result[0].content).toContain('labels');
      expect(result[0].content).toContain('confidence');
    });
  });

  // ── buildSmartReplyPrompt ─────────────────────────────────────────

  describe('buildSmartReplyPrompt', () => {
    it('returns exactly 2 messages', () => {
      const result = builder.buildSmartReplyPrompt('Hi!', []);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('injects last message into user content', () => {
      const result = builder.buildSmartReplyPrompt('Are you free tonight?', []);
      expect(result[1].content).toContain('Are you free tonight?');
    });

    it('includes context messages when provided with role labels', () => {
      const ctx = [
        { role: 'them' as const, body: 'Hello' },
        { role: 'me' as const, body: 'How are you?' },
      ];
      const result = builder.buildSmartReplyPrompt('I am fine', ctx);
      expect(result[1].content).toContain('Họ: Hello');
      expect(result[1].content).toContain('Bạn: How are you?');
    });

    it('system prompt requests suggestions array', () => {
      const result = builder.buildSmartReplyPrompt('test', []);
      expect(result[0].content).toContain('suggestions');
    });

    it('omits context block when context is empty', () => {
      const result = builder.buildSmartReplyPrompt('Hi', []);
      expect(result[1].content).not.toContain('Lịch sử cuộc trò chuyện');
    });
  });

  // ── buildSummaryPrompt ────────────────────────────────────────────

  describe('buildSummaryPrompt', () => {
    it('returns exactly 2 messages', () => {
      const result = builder.buildSummaryPrompt(['msg1', 'msg2']);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('joins messages with newlines in user content', () => {
      const messages = ['Hello there', 'How are you?', 'Fine thanks'];
      const result = builder.buildSummaryPrompt(messages);
      expect(result[1].content).toBe('Hello there\nHow are you?\nFine thanks');
    });

    it('system prompt requests summary JSON field', () => {
      const result = builder.buildSummaryPrompt(['test']);
      expect(result[0].content).toContain('summary');
    });
  });

  // ── buildTranslationPrompt ────────────────────────────────────────

  describe('buildTranslationPrompt', () => {
    it('returns exactly 2 messages', () => {
      const result = builder.buildTranslationPrompt('Hello', 'en', 'vi');
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('puts the text to translate as user content', () => {
      const result = builder.buildTranslationPrompt('Bonjour', 'fr', 'en');
      expect(result[1].content).toBe('Bonjour');
    });

    it('includes target language in system prompt', () => {
      const result = builder.buildTranslationPrompt(
        'Hi',
        undefined,
        'Japanese',
      );
      expect(result[0].content).toContain('Japanese');
    });

    it('includes source language in system prompt when provided', () => {
      const result = builder.buildTranslationPrompt(
        'Ciao',
        'Italian',
        'English',
      );
      expect(result[0].content).toContain('Italian');
    });

    it('works without source language (auto-detect)', () => {
      const result = builder.buildTranslationPrompt('Text', undefined, 'en');
      // Should not throw and should still have 2 messages
      expect(result).toHaveLength(2);
    });

    it('system prompt requests translated_text and source_language fields', () => {
      const result = builder.buildTranslationPrompt('test', 'en', 'vi');
      expect(result[0].content).toContain('translated_text');
      expect(result[0].content).toContain('source_language');
    });
  });

  // ── buildDocumentQueryPrompt ──────────────────────────────────────

  describe('buildDocumentQueryPrompt', () => {
    it('returns exactly 2 messages', () => {
      const chunks = [{ content: 'Relevant info.', chunkIndex: 0 }];
      const result = builder.buildDocumentQueryPrompt('What is this?', chunks);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('injects the query into user content', () => {
      const result = builder.buildDocumentQueryPrompt('What is the price?', [
        { content: 'Price is $100.', chunkIndex: 0 },
      ]);
      expect(result[1].content).toContain('What is the price?');
    });

    it('includes chunk contents in user message', () => {
      const chunks = [
        { content: 'First chunk text', chunkIndex: 0 },
        { content: 'Second chunk text', chunkIndex: 1 },
      ];
      const result = builder.buildDocumentQueryPrompt('Question?', chunks);
      expect(result[1].content).toContain('First chunk text');
      expect(result[1].content).toContain('Second chunk text');
    });

    it('system prompt requests answer and source_indices', () => {
      const result = builder.buildDocumentQueryPrompt('?', []);
      expect(result[0].content).toContain('answer');
      expect(result[0].content).toContain('source_indices');
    });

    it('labels chunks as [Nguồn N] in user content', () => {
      const chunks = [
        { content: 'Alpha', chunkIndex: 0 },
        { content: 'Beta', chunkIndex: 1 },
      ];
      const result = builder.buildDocumentQueryPrompt('?', chunks);
      expect(result[1].content).toContain('[Nguồn 1]');
      expect(result[1].content).toContain('[Nguồn 2]');
    });
  });

  // ── buildEntityDetectionPrompt ────────────────────────────────────

  describe('buildEntityDetectionPrompt', () => {
    it('returns exactly 2 messages: system + user', () => {
      const result = builder.buildEntityDetectionPrompt(
        'Tôi dùng Telegram mỗi ngày',
      );
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('puts the message body as user content', () => {
      const body = 'Figma là tool thiết kế tốt nhất';
      const result = builder.buildEntityDetectionPrompt(body);
      expect(result[1].content).toBe(body);
    });

    it('system prompt requests entities array with text, type, confidence', () => {
      const result = builder.buildEntityDetectionPrompt('test');
      expect(result[0].content).toContain('entities');
      expect(result[0].content).toContain('text');
      expect(result[0].content).toContain('type');
      expect(result[0].content).toContain('confidence');
    });

    it('system prompt lists all entity types', () => {
      const result = builder.buildEntityDetectionPrompt('test');
      const content = result[0].content;
      expect(content).toContain('tool');
      expect(content).toContain('company');
      expect(content).toContain('person');
      expect(content).toContain('concept');
      expect(content).toContain('location');
      expect(content).toContain('product');
    });

    it('system prompt mentions confidence threshold 0.75', () => {
      const result = builder.buildEntityDetectionPrompt('test');
      expect(result[0].content).toContain('0.75');
    });
  });

  // ── buildEntityInfoPrompt ─────────────────────────────────────────

  describe('buildEntityInfoPrompt', () => {
    it('returns exactly 2 messages: system + user', () => {
      const result = builder.buildEntityInfoPrompt('Telegram', 'tool', 'vi');
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
    });

    it('puts entity name in user content', () => {
      const result = builder.buildEntityInfoPrompt('Elon Musk', 'person', 'en');
      expect(result[1].content).toContain('Elon Musk');
    });

    it('puts entity type in user content', () => {
      const result = builder.buildEntityInfoPrompt('Docker', 'tool', 'en');
      expect(result[1].content).toContain('tool');
    });

    it('uses Vietnamese in system prompt when language is vi', () => {
      const result = builder.buildEntityInfoPrompt('Hà Nội', 'location', 'vi');
      expect(result[0].content).toContain('Vietnamese');
    });

    it('uses English in system prompt when language is en', () => {
      const result = builder.buildEntityInfoPrompt(
        'Silicon Valley',
        'location',
        'en',
      );
      expect(result[0].content).toContain('English');
    });

    it('system prompt requests title, summary, details, related_entities', () => {
      const result = builder.buildEntityInfoPrompt('ChatGPT', 'product', 'vi');
      const content = result[0].content;
      expect(content).toContain('title');
      expect(content).toContain('summary');
      expect(content).toContain('details');
      expect(content).toContain('related_entities');
    });

    it('system prompt includes uncertainty guard', () => {
      const result = builder.buildEntityInfoPrompt('ChatGPT', 'product', 'vi');
      expect(result[0].content).toContain('omit');
    });
  });
});
