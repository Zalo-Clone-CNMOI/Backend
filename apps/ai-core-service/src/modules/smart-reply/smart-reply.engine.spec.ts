import { Test, TestingModule } from '@nestjs/testing';
import { SmartReplyEngine } from './smart-reply.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { MessageRepository } from '@libs/scylla';
import type {
  AiSmartReplyRequestEvent,
  AiSmartReplyContextMessage,
} from '@libs/contracts';

function makeEvent(
  overrides: Partial<AiSmartReplyRequestEvent> = {},
): AiSmartReplyRequestEvent {
  return {
    conversation_id: 'conv-001',
    user_id: 'user-001',
    last_message_id: 'msg-001',
    last_message_body: 'How are you?',
    context_messages: [],
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

function llmResult(suggestions: string[]) {
  return {
    content: JSON.stringify({ suggestions }),
    tokensIn: 80,
    tokensOut: 40,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 120,
  };
}

const CTX: AiSmartReplyContextMessage[] = [
  { role: 'them', body: 'Bạn khỏe không?' },
  { role: 'me', body: 'Tớ ổn' },
];

const mockMessageRepo = { getMessages: jest.fn() };

describe('SmartReplyEngine', () => {
  let engine: SmartReplyEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();

    // Clear call history and set a default stub: return empty context so existing
    // tests that don't care about context still pass (ScyllaDB returns nothing →
    // empty context). Must clear BEFORE setting the resolved value.
    mockMessageRepo.getMessages.mockClear();
    mockMessageRepo.getMessages.mockResolvedValue({
      items: [],
      next_cursor: null,
      has_more: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartReplyEngine,
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
        { provide: MessageRepository, useValue: mockMessageRepo },
      ],
    }).compile();

    engine = module.get(SmartReplyEngine);
  });

  describe('generateReplies() — success', () => {
    it('returns 3 suggestions from LLM response', async () => {
      gateway.complete.mockResolvedValue(
        llmResult([
          'I am fine!',
          'Doing well, thanks!',
          'Great, how about you?',
        ]),
      );

      const result = await engine.generateReplies(makeEvent());

      expect(result.suggestions).toEqual([
        'I am fine!',
        'Doing well, thanks!',
        'Great, how about you?',
      ]);
    });

    it('trims suggestions to maximum 3', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(['S1', 'S2', 'S3', 'S4', 'S5']),
      );

      const result = await engine.generateReplies(makeEvent());

      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions).toEqual(['S1', 'S2', 'S3']);
    });

    it('includes conversation_id and user_id in result', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      const result = await engine.generateReplies(
        makeEvent({ conversation_id: 'conv-xyz', user_id: 'user-xyz' }),
      );

      expect(result.conversation_id).toBe('conv-xyz');
      expect(result.user_id).toBe('user-xyz');
    });

    it('records success metrics', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      await engine.generateReplies(makeEvent());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'smart_reply',
        'openai',
        'gpt-4o',
        80,
        40,
        120,
        true,
      );
    });

    it('includes token count in result', async () => {
      gateway.complete.mockResolvedValue(llmResult(['a', 'b', 'c']));

      const result = await engine.generateReplies(makeEvent());

      expect(result.tokens_used).toBe(120);
    });

    it('passes typed context messages to prompt builder with correct role labels', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      await engine.generateReplies(makeEvent({ context_messages: CTX }));

      const calledOptions = gateway.complete.mock.calls[0][1];
      const userContent =
        calledOptions.messages.find((m: { role: string }) => m.role === 'user')
          ?.content ?? '';
      expect(userContent).toContain('Họ: Bạn khỏe không?');
      expect(userContent).toContain('Bạn: Tớ ổn');
    });
  });

  describe('generateReplies() — failure fallback', () => {
    it('returns empty suggestions when LLM throws', async () => {
      gateway.complete.mockRejectedValue(new Error('LLM down'));

      const result = await engine.generateReplies(makeEvent());

      expect(result.suggestions).toEqual([]);
      expect(result.tokens_used).toBe(0);
    });

    it('returns empty suggestions when LLM returns malformed JSON', async () => {
      gateway.complete.mockResolvedValue({
        content: 'not valid json',
        tokensIn: 80,
        tokensOut: 40,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 120,
      });

      const result = await engine.generateReplies(makeEvent());

      expect(result.suggestions).toEqual([]);
    });

    it('returns empty suggestions when JSON is missing suggestions array', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({ wrong_field: 'value' }),
        tokensIn: 80,
        tokensOut: 40,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 120,
      });

      const result = await engine.generateReplies(makeEvent());

      expect(result.suggestions).toEqual([]);
    });

    it('records failure metrics when LLM throws', async () => {
      gateway.complete.mockRejectedValue(new Error('timeout'));

      await engine.generateReplies(makeEvent());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'smart_reply',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );
    });

    it('preserves conversation_id and user_id in fallback result', async () => {
      gateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.generateReplies(
        makeEvent({ conversation_id: 'c-abc', user_id: 'u-abc' }),
      );

      expect(result.conversation_id).toBe('c-abc');
      expect(result.user_id).toBe('u-abc');
    });
  });

  describe('context fetching', () => {
    it('fetches context from ScyllaDB when context_messages is empty', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));
      mockMessageRepo.getMessages.mockResolvedValue({
        items: [
          {
            message_id: 'msg-2',
            conversation_id: 'conv-1',
            sender_id: 'other-user',
            body: 'Hey there',
            created_at: 2000,
          },
          {
            message_id: 'msg-1',
            conversation_id: 'conv-1',
            sender_id: 'user-1',
            body: 'Hello',
            created_at: 1000,
          },
        ],
        next_cursor: null,
        has_more: false,
      });

      await engine.generateReplies(
        makeEvent({
          conversation_id: 'conv-1',
          user_id: 'user-1',
          context_messages: [],
        }),
      );

      expect(mockMessageRepo.getMessages).toHaveBeenCalledWith('conv-1', {
        limit: 10,
      });
      expect(gateway.complete).toHaveBeenCalled();
    });

    it('maps sender_id === user_id to role "me" and others to "them"', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      // DESC order from ScyllaDB: newest first
      mockMessageRepo.getMessages.mockResolvedValue({
        items: [
          {
            message_id: 'msg-3',
            conversation_id: 'conv-1',
            sender_id: 'other-user',
            body: 'See you!',
            created_at: 3000,
          },
          {
            message_id: 'msg-2',
            conversation_id: 'conv-1',
            sender_id: 'user-1',
            body: 'Goodbye',
            created_at: 2000,
          },
          {
            message_id: 'msg-1',
            conversation_id: 'conv-1',
            sender_id: 'other-user',
            body: 'Hi',
            created_at: 1000,
          },
        ],
        next_cursor: null,
        has_more: false,
      });

      // Spy on promptBuilder to capture what context arg was passed
      const promptBuilderSpy = jest.spyOn(
        engine['promptBuilder'],
        'buildSmartReplyPrompt',
      );

      await engine.generateReplies(
        makeEvent({
          conversation_id: 'conv-1',
          user_id: 'user-1',
          context_messages: [],
        }),
      );

      expect(promptBuilderSpy).toHaveBeenCalled();
      const contextArg: AiSmartReplyContextMessage[] =
        promptBuilderSpy.mock.calls[0][1];

      // After reversing DESC results: oldest first → msg-1, msg-2, msg-3
      expect(contextArg).toEqual([
        { role: 'them', body: 'Hi' },
        { role: 'me', body: 'Goodbye' },
        { role: 'them', body: 'See you!' },
      ]);
    });

    it('skips soft-deleted messages', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      mockMessageRepo.getMessages.mockResolvedValue({
        items: [
          {
            message_id: 'msg-2',
            conversation_id: 'conv-1',
            sender_id: 'other-user',
            body: '',
            created_at: 2000,
            deleted_at: 12345,
          },
          {
            message_id: 'msg-1',
            conversation_id: 'conv-1',
            sender_id: 'user-1',
            body: 'Hello',
            created_at: 1000,
          },
        ],
        next_cursor: null,
        has_more: false,
      });

      const promptBuilderSpy = jest.spyOn(
        engine['promptBuilder'],
        'buildSmartReplyPrompt',
      );

      await engine.generateReplies(
        makeEvent({
          conversation_id: 'conv-1',
          user_id: 'user-1',
          context_messages: [],
        }),
      );

      const contextArg: AiSmartReplyContextMessage[] =
        promptBuilderSpy.mock.calls[0][1];

      // Only msg-1 survives (msg-2 was deleted)
      expect(contextArg).toHaveLength(1);
      expect(contextArg[0]).toEqual({ role: 'me', body: 'Hello' });
    });

    it('uses provided context_messages without hitting ScyllaDB', async () => {
      gateway.complete.mockResolvedValue(llmResult(['ok']));

      await engine.generateReplies(
        makeEvent({
          context_messages: [{ role: 'them', body: 'Pre-fetched' }],
        }),
      );

      expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
    });

    it('falls back to empty context when ScyllaDB throws', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(['Try again', 'Sure', 'OK']),
      );
      mockMessageRepo.getMessages.mockRejectedValue(new Error('timeout'));

      const result = await engine.generateReplies(
        makeEvent({
          conversation_id: 'conv-1',
          user_id: 'user-1',
          context_messages: [],
        }),
      );

      // LLM must still be called (with empty context as fallback), result has suggestions
      expect(gateway.complete).toHaveBeenCalled();
      expect(result.suggestions).toEqual(['Try again', 'Sure', 'OK']);
    });
  });
});
