import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModerationEngine } from './moderation.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import { AiModerationLog } from '@libs/database/entities';
import type { AiModerationRequestEvent } from '@libs/contracts';

function makeRequest(
  overrides: Partial<AiModerationRequestEvent> = {},
): AiModerationRequestEvent {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    sender_id: 'user-001',
    created_at: Date.now(),
    body: 'Hello, world!',
    requested_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeGateway() {
  return {
    complete: jest.fn(),
    completeEnsemble: jest.fn(),
    completeStream: jest.fn(),
    embed: jest.fn(),
    getProvider: jest.fn(),
  } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics() {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRepo() {
  return {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

describe('ModerationEngine', () => {
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
        { provide: APP_CONFIG, useValue: { aiModerationEnsemble: false } },
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
        {
          provide: getRepositoryToken(AiModerationLog),
          useValue: moderationRepo,
        },
      ],
    }).compile();

    engine = module.get(ModerationEngine);
  });

  describe('moderate() — success', () => {
    it('returns moderation result with LLM parsed values', async () => {
      const llmResponse = JSON.stringify({
        is_flagged: true,
        labels: ['toxic'],
        confidence: 0.95,
      });

      gateway.complete.mockResolvedValue({
        content: llmResponse,
        tokensIn: 50,
        tokensOut: 30,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 150,
      });
      moderationRepo.create.mockReturnValue({ id: 'log-1' });
      moderationRepo.save.mockResolvedValue({ id: 'log-1' });

      const result = await engine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.labels).toEqual(['toxic']);
      expect(result.confidence).toBe(0.95);
      expect(result.message_id).toBe('msg-001');
      expect(result.created_at).toBeDefined();
    });

    it('returns clean result when LLM says not flagged', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 0.99,
        }),
        tokensIn: 50,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 100,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      const result = await engine.moderate(
        makeRequest({ body: 'Good morning!' }),
      );

      expect(result.is_flagged).toBe(false);
      expect(result.labels).toContain('clean');
    });

    it('parses moderation JSON when provider wraps response in markdown code fence', async () => {
      gateway.complete.mockResolvedValue({
        content:
          '```json\n{"is_flagged":false,"labels":["clean"],"confidence":0.91}\n```',
        tokensIn: 35,
        tokensOut: 12,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 75,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      const result = await engine.moderate(makeRequest({ body: 'Xin chao' }));

      expect(result.is_flagged).toBe(false);
      expect(result.labels).toEqual(['clean']);
      expect(result.decision_source).toBe('model');
    });

    it('persists the moderation log to the database', async () => {
      const llmResult = {
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1.0,
        }),
        tokensIn: 40,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 90,
      };
      gateway.complete.mockResolvedValue(llmResult);
      const logEntity = { id: 'log-x' };
      moderationRepo.create.mockReturnValue(logEntity);
      moderationRepo.save.mockResolvedValue(logEntity);

      await engine.moderate(makeRequest());

      expect(moderationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-001',
          conversationId: 'conv-001',
          senderId: 'user-001',
        }),
      );
      expect(moderationRepo.save).toHaveBeenCalledWith(logEntity);
    });

    it('records metrics on success', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 40,
        tokensOut: 20,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 90,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      await engine.moderate(makeRequest());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'moderation',
        'openai',
        'gpt-4o',
        40,
        20,
        90,
        true,
      );
    });

    it('includes token_used total in result', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 100,
        tokensOut: 50,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 90,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      const result = await engine.moderate(makeRequest());

      expect(result.tokens_used).toBe(150);
    });
  });

  describe('moderate() — failure fallback', () => {
    it('returns safe default when LLM throws', async () => {
      gateway.complete.mockRejectedValue(new Error('LLM timeout'));

      const result = await engine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.labels).toEqual(['spam']);
      expect(result.confidence).toBe(1);
      expect(result.tokens_used).toBe(0);
      expect(result.decision_source).toBe('fallback_provider_failure');
      expect(result.failure_reason).toContain('LLM timeout');
    });

    it('returns safe default when LLM returns invalid JSON', async () => {
      gateway.complete.mockResolvedValue({
        content: 'not json at all',
        tokensIn: 30,
        tokensOut: 10,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 80,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      const result = await engine.moderate(makeRequest());

      // Parse failure uses fail-open: LLM responded but response was unparseable.
      expect(result.is_flagged).toBe(false);
      expect(result.labels).toEqual(['clean']);
      expect(result.decision_source).toBe('fallback_parse_failure');
      expect(result.failure_reason).toBe('moderation_response_parse_failed');
    });

    it('records failure metrics when LLM throws', async () => {
      gateway.complete.mockRejectedValue(new Error('API error'));

      await engine.moderate(makeRequest());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'moderation',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );
    });

    it('preserves message_id and conversation_id in fallback', async () => {
      gateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.moderate(
        makeRequest({
          message_id: 'msg-xyz',
          conversation_id: 'conv-xyz',
        }),
      );

      expect(result.message_id).toBe('msg-xyz');
      expect(result.conversation_id).toBe('conv-xyz');
    });

    it('stays fail-closed even when aiModerationFailOpen is set true', async () => {
      const m = await Test.createTestingModule({
        providers: [
          ModerationEngine,
          {
            provide: APP_CONFIG,
            useValue: {
              aiModerationEnsemble: false,
              aiModerationFailOpen: true,
            },
          },
          { provide: AiGatewayService, useValue: gateway },
          { provide: PromptBuilderService, useClass: PromptBuilderService },
          { provide: AiMetricsService, useValue: metrics },
          {
            provide: getRepositoryToken(AiModerationLog),
            useValue: moderationRepo,
          },
        ],
      }).compile();

      const failClosedEngine = m.get(ModerationEngine);
      gateway.complete.mockRejectedValue(new Error('provider down'));

      const result = await failClosedEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.decision_source).toBe('fallback_provider_failure');
    });
  });

  describe('ensemble flag in single mode', () => {
    it('reflects ensemble=false in result when config is false', async () => {
      gateway.complete.mockResolvedValue({
        content: JSON.stringify({
          is_flagged: false,
          labels: ['clean'],
          confidence: 1,
        }),
        tokensIn: 30,
        tokensOut: 10,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 80,
      });
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});

      const result = await engine.moderate(makeRequest());

      expect(result.ensemble).toBe(false);
    });
  });

  describe('ensemble mode (aiModerationEnsemble=true)', () => {
    let ensembleEngine: ModerationEngine;

    beforeEach(async () => {
      const m = await Test.createTestingModule({
        providers: [
          ModerationEngine,
          { provide: APP_CONFIG, useValue: { aiModerationEnsemble: true } },
          { provide: AiGatewayService, useValue: gateway },
          { provide: PromptBuilderService, useClass: PromptBuilderService },
          { provide: AiMetricsService, useValue: metrics },
          {
            provide: getRepositoryToken(AiModerationLog),
            useValue: moderationRepo,
          },
        ],
      }).compile();
      ensembleEngine = m.get(ModerationEngine);
      moderationRepo.create.mockReturnValue({});
      moderationRepo.save.mockResolvedValue({});
    });

    function vote(
      provider: string,
      isFlagged: boolean,
      label: string,
      confidence: number,
    ) {
      return {
        content: JSON.stringify({
          is_flagged: isFlagged,
          labels: [label],
          confidence,
        }),
        tokensIn: 50,
        tokensOut: 20,
        model: 'gpt-4o',
        provider,
        latencyMs: 100,
      };
    }

    it('uses completeEnsemble (not complete) when ensemble enabled', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', false, 'clean', 0.9),
        vote('openai', false, 'clean', 0.85),
      ]);

      await ensembleEngine.moderate(makeRequest());

      expect(gateway.completeEnsemble).toHaveBeenCalledTimes(1);
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('majority vote — 2/3 flagged → flagged', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', true, 'toxic', 0.9),
        vote('openai', true, 'harassment', 0.85),
        vote('gemini', false, 'clean', 0.7),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);

      expect(result.labels.sort()).toEqual(['harassment', 'toxic'].sort());
    });

    it('majority vote — 1/3 flagged → not flagged', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', true, 'spam', 0.6),
        vote('openai', false, 'clean', 0.9),
        vote('gemini', false, 'clean', 0.95),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(false);
    });

    it('tied vote (1/2) → flagged (fail-closed bias)', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', true, 'toxic', 0.7),
        vote('openai', false, 'clean', 0.6),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
    });

    it('confidence is averaged across majority voters', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', true, 'toxic', 0.8),
        vote('openai', true, 'toxic', 0.6),
        vote('gemini', false, 'clean', 0.9),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);

      expect(result.confidence).toBeCloseTo(0.7, 1);
    });

    it('total tokens summed across all participating providers', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', false, 'clean', 0.9),
        vote('openai', false, 'clean', 0.85),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.tokens_used).toBe(140);
    });

    it('result marked ensemble=true and decision_source=model on success', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', false, 'clean', 0.95),
        vote('openai', false, 'clean', 0.9),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.ensemble).toBe(true);
      expect(result.provider).toBe('ensemble');
      expect(result.decision_source).toBe('model');
    });

    it('falls back fail-closed when no provider succeeds', async () => {
      gateway.completeEnsemble.mockResolvedValue([]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.ensemble).toBe(true);
      expect(result.decision_source).toBe('fallback_provider_failure');
    });

    it('falls back fail-closed when completeEnsemble throws', async () => {
      gateway.completeEnsemble.mockRejectedValue(new Error('budget exceeded'));

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.ensemble).toBe(true);
      expect(result.decision_source).toBe('fallback_provider_failure');
      expect(result.failure_reason).toContain('budget exceeded');
    });

    it('records metrics for each participating provider', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', false, 'clean', 0.9),
        vote('openai', false, 'clean', 0.85),
        vote('gemini', false, 'clean', 0.8),
      ]);

      await ensembleEngine.moderate(makeRequest());

      expect(metrics.recordRequest).toHaveBeenCalledTimes(3);
    });

    it('unanimous 3/3 flagged → all labels unioned', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', true, 'toxic', 0.9),
        vote('openai', true, 'harassment', 0.85),
        vote('gemini', true, 'hate_speech', 0.95),
      ]);

      const result = await ensembleEngine.moderate(makeRequest());

      expect(result.is_flagged).toBe(true);
      expect(result.labels.sort()).toEqual(
        ['harassment', 'hate_speech', 'toxic'].sort(),
      );
    });

    it('persists log row with provider="ensemble" sentinel (not truncated comma list)', async () => {
      gateway.completeEnsemble.mockResolvedValue([
        vote('locdo_router', false, 'clean', 0.9),
        vote('openai', false, 'clean', 0.85),
        vote('gemini', false, 'clean', 0.8),
      ]);

      await ensembleEngine.moderate(makeRequest());

      const created = (
        moderationRepo.create.mock.calls[0] as [{ provider: string }]
      )[0];
      expect(created.provider).toBe('ensemble');
    });
  });
});
