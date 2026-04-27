/**
 * @file smart-reply.engine.spec.ts
 *
 * Unit tests for SmartReplyEngine — 3 suggestion generation via LLM.
 *
 * Covers:
 *  - generateReplies() success path (3 suggestions returned)
 *  - generateReplies() trims to max 3 when LLM returns more
 *  - generateReplies() records metrics on success
 *  - generateReplies() returns empty array on LLM failure
 *  - generateReplies() returns empty array when JSON is malformed
 *  - generateReplies() passes typed conversation context to prompt builder
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { SmartReplyEngine } from './smart-reply.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  AiSmartReplyRequestEvent,
  AiSmartReplyContextMessage,
} from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SmartReplyEngine', () => {
  let engine: SmartReplyEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartReplyEngine,
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
      ],
    }).compile();

    engine = module.get(SmartReplyEngine);
  });

  // ── Success ───────────────────────────────────────────────────────

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

      expect(result.tokens_used).toBe(120); // tokensIn=80 + tokensOut=40
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

  // ── Failure / fallback ────────────────────────────────────────────

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
});
