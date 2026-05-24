import { Test, TestingModule } from '@nestjs/testing';
import { CatchUpEngine } from './catch-up.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { RedisService } from '@libs/redis';
import { MessageRepository } from '@libs/scylla';
import type { AiCatchUpResultEvent } from '@libs/contracts';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMessage(
  id: string,
  createdAt: number,
  overrides: Partial<PersistedMessage> = {},
): PersistedMessage {
  return {
    message_id: id,
    conversation_id: 'conv-001',
    sender_id: 'user-sender',
    body: `Message body ${id}`,
    created_at: createdAt,
    deleted_at: undefined,
    attachments: undefined,
    reply_to_message_id: undefined,
    forwarded_from: undefined,
    ...overrides,
  } as PersistedMessage;
}

/** Build a DESC-sorted array of N messages (newest first). */
function makeMessages(count: number, baseTs = 1_000_000): PersistedMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMessage(`msg-${count - i}`, baseTs + (count - i) * 1000),
  );
}

function llmResult(summary = 'You missed some stuff.') {
  return {
    content: JSON.stringify({ summary }),
    tokensIn: 100,
    tokensOut: 50,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 200,
  };
}

function makeGateway(): jest.Mocked<AiGatewayService> {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeRedis(): jest.Mocked<RedisService> {
  return {
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
    incrBy: jest.fn(),
    ttl: jest.fn(),
    expire: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
}

function makePromptBuilder(): jest.Mocked<PromptBuilderService> {
  return {
    buildCatchUpPrompt: jest.fn().mockReturnValue([]),
    buildSummaryPrompt: jest.fn(),
    buildSummaryUpdatePrompt: jest.fn(),
    buildModerationPrompt: jest.fn(),
    buildSmartReplyPrompt: jest.fn(),
    buildTranslationPrompt: jest.fn(),
    buildEntityDetectionPrompt: jest.fn(),
    buildEntityInfoPrompt: jest.fn(),
    buildDocumentQueryPrompt: jest.fn(),
  } as unknown as jest.Mocked<PromptBuilderService>;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('CatchUpEngine', () => {
  let engine: CatchUpEngine;
  let mockGateway: jest.Mocked<AiGatewayService>;
  let mockRedis: jest.Mocked<RedisService>;
  let mockRepo: { getAllMessages: jest.Mock };
  let mockPromptBuilder: jest.Mocked<PromptBuilderService>;

  beforeEach(async () => {
    mockGateway = makeGateway();
    mockRedis = makeRedis();
    mockPromptBuilder = makePromptBuilder();
    mockRepo = { getAllMessages: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatchUpEngine,
        { provide: AiGatewayService, useValue: mockGateway },
        { provide: PromptBuilderService, useValue: mockPromptBuilder },
        { provide: RedisService, useValue: mockRedis },
        { provide: MessageRepository, useValue: mockRepo },
      ],
    }).compile();

    engine = module.get(CatchUpEngine);
  });

  // ── zero-unread short-circuit ─────────────────────────────────────────────

  describe('zero-unread short-circuit', () => {
    it('returns had_unread:false when since is newer than all messages and does NOT call the gateway', async () => {
      // 5 messages all at ts 1000..5000; since = 9999 (everything is "read")
      const messages = makeMessages(5, 1000);
      mockRepo.getAllMessages.mockResolvedValue(messages);

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: 9_999_999,
      });

      expect(result.had_unread).toBe(false);
      expect(result.summary).toBe('');
      expect(result.message_count).toBe(0);
      expect(result.truncated).toBe(false);
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });

    it('returns had_unread:false when conversation has no messages at all', async () => {
      mockRepo.getAllMessages.mockResolvedValue([]);

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(result.had_unread).toBe(false);
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });

    it('returns had_unread:false when all messages are deleted', async () => {
      const messages = makeMessages(3, 1000).map((m) => ({
        ...m,
        deleted_at: Date.now(),
      }));
      mockRepo.getAllMessages.mockResolvedValue(messages);

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: 0,
      });

      expect(result.had_unread).toBe(false);
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });
  });

  // ── since undefined → all messages treated as unread ─────────────────────

  describe('since undefined', () => {
    it('summarises ALL fetched messages when since is not provided', async () => {
      const messages = makeMessages(10, 1000);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('Lots happened'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(result.had_unread).toBe(true);
      expect(result.message_count).toBe(10);
      expect(result.summary).toBe('Lots happened');
      expect(result.since).toBeUndefined();
      expect(mockGateway.complete).toHaveBeenCalledTimes(1);
    });
  });

  // ── truncation ────────────────────────────────────────────────────────────

  describe('truncation', () => {
    it('truncates to 50 when unread window > 50', async () => {
      const messages = makeMessages(80, 0);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('Summary of latest 50'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(result.truncated).toBe(true);
      expect(result.message_count).toBe(50);
      expect(result.had_unread).toBe(true);
    });

    it('does NOT truncate when window is exactly 50', async () => {
      const messages = makeMessages(50, 0);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('ok'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(result.truncated).toBe(false);
      expect(result.message_count).toBe(50);
    });

    it('honours caller limit when < 50', async () => {
      const messages = makeMessages(30, 0);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('ok'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        limit: 10,
      });

      expect(result.message_count).toBe(10);
      expect(result.truncated).toBe(true);
    });

    it('clamps limit to 50 when caller passes limit > 50', async () => {
      const messages = makeMessages(80, 0);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('ok'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        limit: 100,
      });

      expect(result.message_count).toBe(50);
    });
  });

  // ── deleted messages excluded ─────────────────────────────────────────────

  describe('deleted messages excluded', () => {
    it('excludes soft-deleted messages from the window', async () => {
      const now = 1_000_000;
      const sinceTs = 0;
      // 5 messages: 2 deleted, 3 active
      const messages: PersistedMessage[] = [
        makeMessage('msg-5', now + 5000),
        makeMessage('msg-4', now + 4000, { deleted_at: Date.now() }),
        makeMessage('msg-3', now + 3000),
        makeMessage('msg-2', now + 2000, { deleted_at: Date.now() }),
        makeMessage('msg-1', now + 1000),
      ];
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('Short summary'));

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: sinceTs,
      });

      // Only 3 non-deleted messages should be in the window
      expect(result.message_count).toBe(3);
      expect(result.had_unread).toBe(true);
      // The prompt builder should have been called with the bodies of live msgs
      const callArg = mockPromptBuilder.buildCatchUpPrompt.mock.calls[0][0];
      expect(callArg).toHaveLength(3);
    });
  });

  // ── cache hit ─────────────────────────────────────────────────────────────

  describe('cache hit', () => {
    it('returns cached result with cached:true and does NOT call the gateway a second time', async () => {
      const messages = makeMessages(5, 1000);
      mockRepo.getAllMessages.mockResolvedValue(messages);

      // First call — cache miss, gateway is invoked
      mockRedis.get.mockResolvedValue(null);
      mockGateway.complete.mockResolvedValue(llmResult('First result'));

      const first = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: 0,
      });
      expect(first.cached).toBe(false);
      expect(mockGateway.complete).toHaveBeenCalledTimes(1);

      // Second call — simulate the cache storing the result
      const cachedPayload: AiCatchUpResultEvent = {
        ...first,
        cached: false, // stored value has cached:false; engine sets cached:true on read
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedPayload));
      mockGateway.complete.mockClear();

      const second = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: 0,
      });

      expect(second.cached).toBe(true);
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });
  });

  // ── happy path ────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns the correct from/to message ids, provider, tokens_used, and summary', async () => {
      const sinceTs = 1_000_000;
      // DESC order: newest (msg-5) first
      const messages: PersistedMessage[] = [
        makeMessage('msg-5', sinceTs + 5000),
        makeMessage('msg-4', sinceTs + 4000),
        makeMessage('msg-3', sinceTs + 3000),
        makeMessage('msg-2', sinceTs + 2000),
        makeMessage('msg-1', sinceTs + 1000),
      ];
      mockRepo.getAllMessages.mockResolvedValue(messages);

      const gatewayResult = {
        content: JSON.stringify({ summary: 'Test summary text' }),
        tokensIn: 200,
        tokensOut: 80,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 150,
      };
      mockGateway.complete.mockResolvedValue(gatewayResult);

      const result = await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: sinceTs,
        trace_id: 'trace-xyz',
      });

      expect(result.had_unread).toBe(true);
      expect(result.summary).toBe('Test summary text');
      expect(result.message_count).toBe(5);
      // Oldest in the window (ASC order) is msg-1, newest is msg-5
      expect(result.from_message_id).toBe('msg-1');
      expect(result.to_message_id).toBe('msg-5');
      expect(result.provider).toBe('openai');
      expect(result.tokens_used).toBe(280); // 200 + 80
      expect(result.cached).toBe(false);
      expect(result.trace_id).toBe('trace-xyz');
      expect(result.truncated).toBe(false);
    });

    it('writes the result to Redis after a cache miss', async () => {
      const messages = makeMessages(3, 5000);
      mockRepo.getAllMessages.mockResolvedValue(messages);
      mockGateway.complete.mockResolvedValue(llmResult('cached later'));

      await engine.summarizeUnread({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(mockRedis.setEx).toHaveBeenCalledTimes(1);
      const [key, ttl, payload] = mockRedis.setEx.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(key).toMatch(/^ai:catchup:/);
      expect(ttl).toBe(600);
      const stored = JSON.parse(payload) as AiCatchUpResultEvent;
      expect(stored.summary).toBe('cached later');
    });
  });
});
