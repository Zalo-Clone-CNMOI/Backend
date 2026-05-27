import { Test, TestingModule } from '@nestjs/testing';
import { ZaiMemoryService } from './zai-memory.service';
import { MessageRepository } from '@libs/scylla';
import { RedisService } from '@libs/redis';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';
import type { LlmChatMessage } from '../ai-gateway/interfaces';

const CONV_ID = 'conv-001';
const USER_ID = 'user-001';

function makeMsg(id: string, body: string): PersistedMessage {
  return {
    message_id: id,
    conversation_id: CONV_ID,
    sender_id: USER_ID,
    body,
    created_at: Date.now(),
  } as PersistedMessage;
}

/** N persisted messages (DESC, newest first) with non-empty bodies. */
function makeMessages(n: number): PersistedMessage[] {
  return Array.from({ length: n }, (_, i) => makeMsg(`m${i}`, `body ${i}`));
}

const L1: LlmChatMessage[] = [{ role: 'user', content: 'recent' }];

describe('ZaiMemoryService', () => {
  let service: ZaiMemoryService;
  let messageRepo: jest.Mocked<MessageRepository>;
  let gateway: jest.Mocked<AiGatewayService>;
  let promptBuilder: jest.Mocked<PromptBuilderService>;
  let aiMetrics: jest.Mocked<AiMetricsService>;
  let redis: jest.Mocked<RedisService>;

  async function build(config: Record<string, unknown>) {
    messageRepo = {
      getAllMessages: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MessageRepository>;
    gateway = {
      complete: jest.fn().mockResolvedValue({
        content: '{"summary":"older topics summarized"}',
        tokensIn: 40,
        tokensOut: 15,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 200,
      }),
    } as unknown as jest.Mocked<AiGatewayService>;
    promptBuilder = {
      buildSummaryPrompt: jest.fn((lines: string[]) => [
        { role: 'system' as const, content: 'summarize' },
        { role: 'user' as const, content: lines.join('\n') },
      ]),
    } as unknown as jest.Mocked<PromptBuilderService>;
    aiMetrics = {
      recordRequest: jest.fn(),
    } as unknown as jest.Mocked<AiMetricsService>;
    redis = {
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RedisService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZaiMemoryService,
        { provide: MessageRepository, useValue: messageRepo },
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useValue: promptBuilder },
        { provide: AiMetricsService, useValue: aiMetrics },
        { provide: RedisService, useValue: redis },
        { provide: APP_CONFIG, useValue: config },
      ],
    }).compile();

    service = module.get<ZaiMemoryService>(ZaiMemoryService);
  }

  afterEach(() => jest.clearAllMocks());

  // ── Disabled (default) ──────────────────────────────────────────────────────

  it('disabled: no-op, returns L1 unchanged with zero I/O', async () => {
    await build({ zaiL2MemoryEnabled: false });

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(out).toBe(L1);
    expect(messageRepo.getAllMessages).not.toHaveBeenCalled();
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  it('flag omitted: treated as disabled', async () => {
    await build({});

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(out).toBe(L1);
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  // ── Enabled, below trigger ──────────────────────────────────────────────────

  it('enabled but total history <= trigger: returns L1, no summarize', async () => {
    await build({ zaiL2MemoryEnabled: true, zaiL2SummaryTriggerTurns: 30 });
    messageRepo.getAllMessages.mockResolvedValue(makeMessages(25));

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(out).toBe(L1);
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  // ── Enabled, above trigger ──────────────────────────────────────────────────

  it('enabled and total history > trigger: summarizes older window, prepends summary', async () => {
    await build({ zaiL2MemoryEnabled: true, zaiL2SummaryTriggerTurns: 30 });
    messageRepo.getAllMessages.mockResolvedValue(makeMessages(40));

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(gateway.complete).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('older topics summarized');
    expect(out[1]).toBe(L1[0]);
    // Cached for reuse.
    expect(redis.setEx).toHaveBeenCalledWith(
      'zai:l2:conv-001',
      expect.any(Number),
      'older topics summarized',
    );
    // Success metrics recorded under a dedicated operation label.
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'zai_l2_memory',
      'openai',
      'gpt-4o',
      40,
      15,
      200,
      true,
    );
  });

  it('reuses a cached rolling summary without calling the LLM', async () => {
    await build({ zaiL2MemoryEnabled: true, zaiL2SummaryTriggerTurns: 30 });
    messageRepo.getAllMessages.mockResolvedValue(makeMessages(40));
    redis.get.mockResolvedValue('cached summary text');

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(gateway.complete).not.toHaveBeenCalled();
    expect(out[0].content).toContain('cached summary text');
  });

  // ── Failure handling ─────────────────────────────────────────────────────────

  it('fail-safe: ScyllaDB fetch error returns pure L1', async () => {
    await build({ zaiL2MemoryEnabled: true, zaiL2SummaryTriggerTurns: 30 });
    messageRepo.getAllMessages.mockRejectedValue(new Error('scylla down'));

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(out).toBe(L1);
  });

  it('fail-safe: LLM error returns pure L1 and records a failure metric', async () => {
    await build({ zaiL2MemoryEnabled: true, zaiL2SummaryTriggerTurns: 30 });
    messageRepo.getAllMessages.mockResolvedValue(makeMessages(40));
    gateway.complete.mockRejectedValue(new Error('LLM down'));

    const out = await service.withRollingSummary(CONV_ID, USER_ID, L1);

    expect(out).toBe(L1);
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'zai_l2_memory',
      'unknown',
      'unknown',
      0,
      0,
      0,
      false,
    );
  });
});
