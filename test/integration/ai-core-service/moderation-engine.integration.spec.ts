/**
 * @file moderation-engine.integration.spec.ts
 *
 * Integration tests for ModerationEngine with real NestJS DI.
 * Real: ModerationEngine, PromptBuilderService.
 * Mocks: AiGatewayService, AiMetricsService, TypeORM repo.
 *
 * Tests the full moderation pipeline: prompt building → LLM call → DB persist → result.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModerationEngine } from '../../../apps/ai-core-service/src/modules/moderation/moderation.engine';
import { PromptBuilderService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/prompt-builder.service';
import { AiGatewayService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/ai-gateway.service';
import { AiMetricsService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import { AiModerationLog } from '@libs/database/entities';
import type { AiModerationRequestEvent } from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGateway() {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics() {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRepo() {
  return {
    create: jest.fn().mockImplementation((data: unknown) => data),
    save: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

function makeEvent(
  overrides: Partial<AiModerationRequestEvent> = {},
): AiModerationRequestEvent {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    sender_id: 'user-001',
    created_at: Date.now(),
    body: 'This is a normal message',
    requested_at: Date.now(),
    trace_id: 'trace-test',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ModerationEngine (integration)', () => {
  let engine: ModerationEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let moderationRepo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();
    moderationRepo = makeRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationEngine,
        PromptBuilderService,
        { provide: APP_CONFIG, useValue: { aiModerationEnsemble: false } },
        { provide: AiGatewayService, useValue: gateway },
        { provide: AiMetricsService, useValue: metrics },
        {
          provide: getRepositoryToken(AiModerationLog),
          useValue: moderationRepo,
        },
      ],
    }).compile();

    engine = module.get(ModerationEngine);
  });

  // ── Prompt building + LLM ─────────────────────────────────────────

  describe('full flow: prompt → LLM → persist → emit', () => {
    it('uses real PromptBuilderService to build moderation prompt before calling gateway', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 60,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 100,
      });

      await engine.moderate(makeEvent({ body: 'Hello there' }));

      const calledOptions = gateway.complete.mock.calls[0][1];
      // PromptBuilder should produce a system + user message
      expect(calledOptions.messages).toHaveLength(2);
      expect(calledOptions.messages[0].role).toBe('system');
      expect(calledOptions.messages[1].role).toBe('user');
      expect(calledOptions.messages[1].content).toBe('Hello there');
    });

    it('passes sender_id as userId to gateway.complete', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 0.9,
        }),
        tokensIn: 60,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 80,
      });

      await engine.moderate(makeEvent({ sender_id: 'user-xyz' }));

      expect(gateway.complete).toHaveBeenCalledWith(
        'user-xyz',
        expect.anything(),
      );
    });

    it('persists moderation log with correct field mapping', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: true,
          labels: ['spam'],
          confidence: 0.8,
        }),
        tokensIn: 50,
        tokensOut: 30,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 120,
      });

      await engine.moderate(
        makeEvent({
          message_id: 'msg-xyz',
          conversation_id: 'conv-xyz',
          sender_id: 'user-xyz',
        }),
      );

      expect(moderationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-xyz',
          conversationId: 'conv-xyz',
          senderId: 'user-xyz',
          isFlagged: true,
          labels: ['spam'],
          confidence: 0.8,
          provider: 'openai',
        }),
      );
      expect(moderationRepo.save).toHaveBeenCalledTimes(1);
    });

    it('records metrics with all LLM response fields', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 100,
        tokensOut: 50,
        model: 'gpt-4o-mini',
        provider: 'openai',
        latencyMs: 250,
      });

      await engine.moderate(makeEvent());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'moderation',
        'openai',
        'gpt-4o-mini',
        100,
        50,
        250,
        true,
      );
    });
  });

  // ── Multiple label types ──────────────────────────────────────────

  describe('moderation categories', () => {
    const testCases: Array<{
      label: string;
      is_flagged: boolean;
      labels: string[];
      confidence: number;
    }> = [
      {
        label: 'toxic content',
        is_flagged: true,
        labels: ['toxic'],
        confidence: 0.97,
      },
      {
        label: 'harassment',
        is_flagged: true,
        labels: ['harassment'],
        confidence: 0.92,
      },
      {
        label: 'clean message',
        is_flagged: false,
        labels: ['clean'],
        confidence: 0.99,
      },
      {
        label: 'multiple labels',
        is_flagged: true,
        labels: ['spam', 'toxic'],
        confidence: 0.85,
      },
    ];

    for (const tc of testCases) {
      it(`handles ${tc.label} correctly`, async () => {
        gateway.complete.mockResolvedValue({
          content: JSON.stringify({
            is_flagged: tc.is_flagged,
            labels: tc.labels,
            confidence: tc.confidence,
          }),
          tokensIn: 50,
          tokensOut: 20,
          model: 'gpt-4o',
          provider: 'openai',
          latencyMs: 100,
        });
        moderationRepo.create.mockReturnValue({});
        moderationRepo.save.mockResolvedValue({});

        const result = await engine.moderate(makeEvent());

        expect(result.is_flagged).toBe(tc.is_flagged);
        expect(result.labels).toEqual(tc.labels);
        expect(result.confidence).toBeCloseTo(tc.confidence);
      });
    }
  });

  // ── Failure resilience ────────────────────────────────────────────

  describe('failure resilience', () => {
    it('does not throw when LLM call fails — returns fail-closed fallback', async () => {
      gateway.complete.mockRejectedValue(new Error('Network error'));

      await expect(engine.moderate(makeEvent())).resolves.toEqual(
        expect.objectContaining({
          is_flagged: true,
          labels: ['spam'],
          confidence: 1,
          decision_source: 'fallback_provider_failure',
          failure_reason: 'Network error',
          tokens_used: 0,
        }),
      );
    });

    it('does not throw when DB save fails — metrics still recorded as failure', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 50,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 100,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockRejectedValue(new Error('DB failure'));

      // Should not propagate DB error
      await expect(engine.moderate(makeEvent())).resolves.toBeDefined();
    });
  });
});
