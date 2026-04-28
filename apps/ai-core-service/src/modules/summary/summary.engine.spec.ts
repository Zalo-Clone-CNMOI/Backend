import { Test, TestingModule } from '@nestjs/testing';
import { SummaryEngine } from './summary.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import { RedisService } from '@libs/redis';
import { MessageRepository } from '@libs/scylla';
import type { AiSummaryRequestEvent } from '@libs/contracts';

function makeEvent(
  overrides: Partial<AiSummaryRequestEvent> = {},
): AiSummaryRequestEvent {
  return {
    conversation_id: 'conv-001',
    user_id: 'user-001',
    messages: ['Alice: Hi Bob', 'Bob: Hey Alice', 'Alice: How are you?'],
    message_ids: ['m1', 'm2', 'm3'],
    requested_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeGateway(): jest.Mocked<AiGatewayService> {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics(): jest.Mocked<AiMetricsService> {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRedis(): jest.Mocked<RedisService> {
  return {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    incrBy: jest.fn(),
    ttl: jest.fn(),
    expire: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
}

function llmResult(content: string) {
  return {
    content,
    tokensIn: 150,
    tokensOut: 80,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 300,
  };
}

describe('SummaryEngine', () => {
  let engine: SummaryEngine;
  let mockGateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let mockRedis: jest.Mocked<RedisService>;
  let mockPromptBuilder: jest.Mocked<PromptBuilderService>;
  let mockMessageRepo: { getAllMessages: jest.Mock };

  beforeEach(async () => {
    mockGateway = makeGateway();
    metrics = makeMetrics();
    mockRedis = makeRedis();
    mockMessageRepo = { getAllMessages: jest.fn() };
    mockPromptBuilder = {
      buildSummaryPrompt: jest.fn().mockReturnValue([]),
      buildSummaryUpdatePrompt: jest.fn().mockReturnValue([]),
      buildModerationPrompt: jest.fn(),
      buildSmartReplyPrompt: jest.fn(),
      buildTranslationPrompt: jest.fn(),
      buildEntityDetectionPrompt: jest.fn(),
      buildEntityInfoPrompt: jest.fn(),
      buildDocumentQueryPrompt: jest.fn(),
    } as unknown as jest.Mocked<PromptBuilderService>;

    mockMessageRepo.getAllMessages.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryEngine,
        { provide: APP_CONFIG, useValue: { aiEnableConversationCache: true } },
        { provide: AiGatewayService, useValue: mockGateway },
        { provide: PromptBuilderService, useValue: mockPromptBuilder },
        { provide: AiMetricsService, useValue: metrics },
        { provide: RedisService, useValue: mockRedis },
        { provide: MessageRepository, useValue: mockMessageRepo },
      ],
    }).compile();

    engine = module.get(SummaryEngine);
  });

  describe('summarize() — cache hit', () => {
    it('returns cached result with cached=true', async () => {
      const cached = {
        conversation_id: 'conv-001',
        summary: 'A quick chat about greetings.',
        message_range: { from_message_id: 'm1', to_message_id: 'm3', count: 3 },
        provider: 'openai',
        tokens_used: 230,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));
      mockMessageRepo.getAllMessages.mockResolvedValue([]);

      const result = await engine.summarize(makeEvent(), []);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('A quick chat about greetings.');
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });

    it('uses ai:summary:{conversationId} as cache key', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          conversation_id: 'conv-001',
          summary: 'Summary',
          message_range: {
            from_message_id: 'm1',
            to_message_id: 'm3',
            count: 3,
          },
          provider: 'openai',
          tokens_used: 100,
        }),
      );
      mockMessageRepo.getAllMessages.mockResolvedValue([]);

      await engine.summarize(makeEvent({ conversation_id: 'conv-xyz' }), []);

      expect(mockRedis.get).toHaveBeenCalledWith('ai:summary:conv-xyz');
    });

    it('injects current user_id into cached result', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          conversation_id: 'conv-001',
          summary: 'Cached summary.',
          message_range: {
            from_message_id: 'm1',
            to_message_id: 'm3',
            count: 3,
          },
          provider: 'openai',
          tokens_used: 100,
        }),
      );
      mockMessageRepo.getAllMessages.mockResolvedValue([]);

      const result = await engine.summarize(
        makeEvent({ user_id: 'user-current' }),
        [],
      );

      expect(result.user_id).toBe('user-current');
    });
  });

  describe('summarize() — cache miss', () => {
    it('calls LLM and returns generated summary', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'A short summary.' })),
      );

      const result = await engine.summarize(makeEvent(), [
        'msg1',
        'msg2',
        'msg3',
      ]);

      expect(result.summary).toBe('A short summary.');
      expect(result.cached).toBe(false);
    });

    it('stores generated summary in Redis cache', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Stored summary.' })),
      );

      const ev = makeEvent();
      await engine.summarize(ev, ev.messages);

      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'ai:summary:conv-001',
        3600,
        expect.stringContaining('Stored summary.'),
      );
    });

    it('sets correct message_range from message_ids', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Summary' })),
      );

      const result = await engine.summarize(
        makeEvent({
          message_ids: ['first', 'middle', 'last'],
          messages: ['m1', 'm2', 'm3'],
        }),
        ['m1', 'm2', 'm3'],
      );

      expect(result.message_range.from_message_id).toBe('first');
      expect(result.message_range.to_message_id).toBe('last');
      expect(result.message_range.count).toBe(3);
    });

    it('records success metrics', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Done' })),
      );

      const ev = makeEvent();
      await engine.summarize(ev, ev.messages);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'summary',
        'openai',
        'gpt-4o',
        150,
        80,
        300,
        true,
      );
    });

    it('handles plain-text LLM response (non-JSON)', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(llmResult('A plain text summary.'));

      const ev = makeEvent();
      const result = await engine.summarize(ev, ev.messages);

      expect(result.summary).toBe('A plain text summary.');
    });
  });

  describe('summarize() — failure fallback', () => {
    it('returns failure summary when LLM throws', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockGateway.complete.mockRejectedValue(new Error('LLM error'));

      const ev = makeEvent();
      const result = await engine.summarize(ev, ev.messages);

      expect(result.summary).toContain('failed');
      expect(result.cached).toBe(false);
      expect(result.tokens_used).toBe(0);
    });

    it('records failure metrics when LLM throws', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockGateway.complete.mockRejectedValue(new Error('timeout'));

      const ev = makeEvent();
      await engine.summarize(ev, ev.messages);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'summary',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );
    });

    it('preserves conversation_id in fallback result', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockGateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.summarize(
        makeEvent({ conversation_id: 'c-xyz' }),
        [],
      );

      expect(result.conversation_id).toBe('c-xyz');
    });
  });

  describe('summarize() — corrupted cache', () => {
    it('regenerates when cached value is invalid JSON', async () => {
      mockRedis.get.mockResolvedValue('{invalid json}');
      mockRedis.setEx.mockResolvedValue(undefined);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Regenerated.' })),
      );

      const ev = makeEvent();
      const result = await engine.summarize(ev, ev.messages);

      expect(mockGateway.complete).toHaveBeenCalledTimes(1);
      expect(result.summary).toBe('Regenerated.');
    });
  });

  describe('summarize() — cache disabled', () => {
    it('does not read or write Redis when cache is disabled', async () => {
      const moduleNoCache = await Test.createTestingModule({
        providers: [
          SummaryEngine,
          {
            provide: APP_CONFIG,
            useValue: { aiEnableConversationCache: false },
          },
          { provide: AiGatewayService, useValue: mockGateway },
          { provide: PromptBuilderService, useValue: mockPromptBuilder },
          { provide: AiMetricsService, useValue: metrics },
          { provide: RedisService, useValue: mockRedis },
          { provide: MessageRepository, useValue: mockMessageRepo },
        ],
      }).compile();

      const noCacheEngine = moduleNoCache.get(SummaryEngine);
      mockGateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Fresh.' })),
      );

      const ev = makeEvent();
      const result = await noCacheEngine.summarize(ev, ev.messages);

      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.setEx).not.toHaveBeenCalled();
      expect(result.summary).toBe('Fresh.');
    });
  });

  describe('ScyllaDB context fetch', () => {
    const event = {
      conversation_id: 'conv-1',
      user_id: 'user-1',
      messages: [],
      message_ids: [],
      requested_at: Date.now(),
    };

    beforeEach(() => {
      mockRedis.get.mockResolvedValue(null);
      mockGateway.complete.mockResolvedValue({
        content: '{"summary":"Team discussed project."}',
        tokensIn: 200, tokensOut: 50, model: 'gpt-4o-mini', provider: 'openai', latencyMs: 300,
      });
    });

    it('fetches messages from ScyllaDB when event.messages is empty', async () => {
      mockMessageRepo.getAllMessages.mockResolvedValue([
        { message_id: 'msg-3', body: 'Third', created_at: 300, deleted_at: null },
        { message_id: 'msg-2', body: 'Second', created_at: 200, deleted_at: null },
        { message_id: 'msg-1', body: 'First', created_at: 100, deleted_at: null },
      ]);

      const result = await engine.summarize(event, []);

      expect(mockMessageRepo.getAllMessages).toHaveBeenCalledWith('conv-1', 100);
      // reversed from DESC → oldest first
      expect(mockPromptBuilder.buildSummaryPrompt).toHaveBeenCalledWith(['First', 'Second', 'Third']);
      expect(result.summary).toBe('Team discussed project.');
    });

    it('uses event.messages directly when non-empty (no ScyllaDB call)', async () => {
      const eventWithMessages = { ...event, messages: ['Hello', 'World'], message_ids: ['m1', 'm2'] };

      await engine.summarize(eventWithMessages, eventWithMessages.messages);

      expect(mockMessageRepo.getAllMessages).not.toHaveBeenCalled();
    });

    it('returns emptySummaryResult when ScyllaDB returns no messages', async () => {
      mockMessageRepo.getAllMessages.mockResolvedValue([]);

      const result = await engine.summarize(event, []);

      expect(result.summary).toBe('No messages to summarize.');
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });
  });

  describe('incremental summarization', () => {
    const cachedPayload = JSON.stringify({
      conversation_id: 'conv-1',
      summary: 'Team discussed deadline.',
      message_range: { from_message_id: 'msg-1', to_message_id: 'msg-5', count: 5 },
      provider: 'openai',
      tokens_used: 150,
    });

    const event = {
      conversation_id: 'conv-1',
      user_id: 'user-1',
      messages: [],
      message_ids: [],
      requested_at: Date.now(),
    };

    beforeEach(() => {
      mockGateway.complete.mockResolvedValue({
        content: '{"summary":"Updated summary."}',
        tokensIn: 180, tokensOut: 40, model: 'gpt-4o-mini', provider: 'openai', latencyMs: 250,
      });
    });

    it('returns cached summary when no new messages (< 3 new)', async () => {
      mockRedis.get.mockResolvedValue(cachedPayload);
      mockMessageRepo.getAllMessages.mockResolvedValue([
        { message_id: 'msg-6', body: 'One new', created_at: 600, deleted_at: null },
        { message_id: 'msg-5', body: 'Cached last', created_at: 500, deleted_at: null },
      ]);

      const result = await engine.summarize(event, []);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('Team discussed deadline.');
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });

    it('runs incremental update when >= 3 new messages', async () => {
      mockRedis.get.mockResolvedValue(cachedPayload);
      mockMessageRepo.getAllMessages.mockResolvedValue([
        { message_id: 'msg-8', body: 'Newest', created_at: 800, deleted_at: null },
        { message_id: 'msg-7', body: 'Seventh', created_at: 700, deleted_at: null },
        { message_id: 'msg-6', body: 'Sixth', created_at: 600, deleted_at: null },
        { message_id: 'msg-5', body: 'Cached last', created_at: 500, deleted_at: null },
      ]);
      mockPromptBuilder.buildSummaryUpdatePrompt.mockReturnValue([]);

      const result = await engine.summarize(event, []);

      expect(mockPromptBuilder.buildSummaryUpdatePrompt).toHaveBeenCalledWith(
        'Team discussed deadline.',
        ['Sixth', 'Seventh', 'Newest'], // chronological order
      );
      expect(result.cached).toBe(false);
      expect(result.summary).toBe('Updated summary.');
    });

    it('skips deleted messages in incremental new messages', async () => {
      mockRedis.get.mockResolvedValue(cachedPayload);
      mockMessageRepo.getAllMessages.mockResolvedValue([
        { message_id: 'msg-9', body: '', deleted_at: 999, created_at: 900 },
        { message_id: 'msg-8', body: 'Real msg', created_at: 800, deleted_at: null },
        { message_id: 'msg-7', body: 'Another', created_at: 700, deleted_at: null },
        { message_id: 'msg-6', body: 'Third new', created_at: 600, deleted_at: null },
        { message_id: 'msg-5', body: 'Cached last', created_at: 500, deleted_at: null },
      ]);
      mockPromptBuilder.buildSummaryUpdatePrompt.mockReturnValue([]);

      await engine.summarize(event, []);

      const [, newMsgs] = mockPromptBuilder.buildSummaryUpdatePrompt.mock.calls[0] as [string, string[]];
      expect(newMsgs).not.toContain(''); // deleted msg body excluded
      expect(newMsgs).toContain('Real msg');
    });

    it('falls back to cached result when incremental LLM call fails', async () => {
      mockRedis.get.mockResolvedValue(cachedPayload);
      mockMessageRepo.getAllMessages.mockResolvedValue([
        { message_id: 'msg-8', body: 'C', created_at: 800, deleted_at: null },
        { message_id: 'msg-7', body: 'B', created_at: 700, deleted_at: null },
        { message_id: 'msg-6', body: 'A', created_at: 600, deleted_at: null },
        { message_id: 'msg-5', body: 'Cached last', created_at: 500, deleted_at: null },
      ]);
      mockPromptBuilder.buildSummaryUpdatePrompt.mockReturnValue([]);
      mockGateway.complete.mockRejectedValue(new Error('LLM timeout'));

      const result = await engine.summarize(event, []);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('Team discussed deadline.'); // stale cache returned
    });
  });
});
