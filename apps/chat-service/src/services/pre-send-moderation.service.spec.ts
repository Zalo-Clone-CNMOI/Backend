import { AxiosError, type AxiosResponse } from 'axios';
import { ConversationType } from '@app/constant';
import type { AppConfig } from '@libs/config';
import type { CacheService } from '@libs/redis';
import type { AiCoreClientService } from '@app/clients';
import {
  PreSendModerationService,
  RejectionInfo,
} from './pre-send-moderation.service';
import type { PreSendModerationMetricsService } from './pre-send-moderation.metrics';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeService(
  partial: {
    config?: Partial<AppConfig>;
    cacheGet?: jest.Mock;
    cacheSet?: jest.Mock;
    llmCheck?: jest.Mock;
    metrics?: Partial<jest.Mocked<PreSendModerationMetricsService>>;
  } = {},
) {
  const cacheService = {
    getModerationFastResult:
      partial.cacheGet ?? jest.fn().mockResolvedValue(null),
    setModerationFastResult:
      partial.cacheSet ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;

  const aiCoreClient = {
    checkPreSendModeration:
      partial.llmCheck ??
      jest.fn().mockResolvedValue({
        is_flagged: false,
        labels: ['clean'],
        confidence: 0.98,
        decision_source: 'model',
      }),
  } as unknown as AiCoreClientService;

  const metrics = {
    recordOutcome: jest.fn(),
    observeDuration: jest.fn(),
    ...partial.metrics,
  } as unknown as PreSendModerationMetricsService;

  const config: AppConfig = {
    chatPreSendModerationEnabled: true,
    chatPreSendModerationSkipConvTypes: [
      ConversationType.DIRECT,
      ConversationType.AI_ASSISTANT,
    ],
    chatPreSendModerationTimeoutMs: 2000,
    chatPreSendModerationConfidenceThreshold: 0.85,
    chatPreSendModerationCacheTtlSeconds: 86400,
    chatPreSendModerationBlockCacheTtlSeconds: 900,
    ...partial.config,
  } as unknown as AppConfig;

  const service = new PreSendModerationService(
    cacheService,
    aiCoreClient,
    metrics,
    config,
  );
  return {
    service,
    cacheService,
    aiCoreClient,
    metrics: metrics as jest.Mocked<PreSendModerationMetricsService>,
  };
}

const DEFAULT_INPUT = {
  senderId: 'sender-1',
  conversationId: 'conv-1',
  body: 'hello team',
  conversationType: ConversationType.GROUP as ConversationType | null,
  traceId: 'trace-1',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PreSendModerationService', () => {
  afterEach(() => jest.clearAllMocks());

  it('feature flag OFF → null + metric disabled, no cache or LLM hit', async () => {
    const { service, aiCoreClient, cacheService, metrics } = makeService({
      config: { chatPreSendModerationEnabled: false },
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toBeNull();
    expect(metrics.recordOutcome).toHaveBeenCalledWith('disabled', 'group');
    expect(aiCoreClient.checkPreSendModeration).not.toHaveBeenCalled();
    expect(cacheService.getModerationFastResult).not.toHaveBeenCalled();
  });

  it('skip-list DIRECT → null + skipped_conv_type metric', async () => {
    const { service, aiCoreClient, metrics } = makeService();

    const result = await service.checkOrAllow({
      ...DEFAULT_INPUT,
      conversationType: ConversationType.DIRECT,
    });

    expect(result).toBeNull();
    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'skipped_conv_type',
      'direct',
    );
    expect(aiCoreClient.checkPreSendModeration).not.toHaveBeenCalled();
  });

  it('skip-list AI_ASSISTANT → null + skipped_conv_type metric', async () => {
    const { service, aiCoreClient, metrics } = makeService();

    await service.checkOrAllow({
      ...DEFAULT_INPUT,
      conversationType: ConversationType.AI_ASSISTANT,
    });

    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'skipped_conv_type',
      'ai_assistant',
    );
    expect(aiCoreClient.checkPreSendModeration).not.toHaveBeenCalled();
  });

  it('skip-list type-safe — GROUP is NOT in default skip list, gate runs', async () => {
    // Regression guard for the v2 audit case-sensitivity concern.
    const { service, aiCoreClient } = makeService();

    await service.checkOrAllow({
      ...DEFAULT_INPUT,
      conversationType: ConversationType.GROUP,
    });

    expect(aiCoreClient.checkPreSendModeration).toHaveBeenCalled();
  });

  it('cache hit clean → null + cache_hit_clean metric + NO LLM call', async () => {
    const { service, aiCoreClient, metrics } = makeService({
      cacheGet: jest.fn().mockResolvedValue({
        is_flagged: false,
        labels: ['clean'],
        confidence: 0.97,
      }),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toBeNull();
    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'cache_hit_clean',
      'group',
    );
    expect(aiCoreClient.checkPreSendModeration).not.toHaveBeenCalled();
  });

  it('cache hit block (confidence above threshold) → rejection, NO LLM call', async () => {
    const { service, aiCoreClient, metrics } = makeService({
      cacheGet: jest.fn().mockResolvedValue({
        is_flagged: true,
        labels: ['toxic'],
        confidence: 0.95,
      }),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toMatchObject({
      reason: 'moderation',
      labels: ['toxic'],
      confidence: 0.95,
    });
    expect((result as RejectionInfo).bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'cache_hit_block',
      'group',
    );
    expect(aiCoreClient.checkPreSendModeration).not.toHaveBeenCalled();
  });

  it('LLM clean → null + clean cache populated with 24h TTL', async () => {
    const { service, cacheService, metrics } = makeService({
      llmCheck: jest.fn().mockResolvedValue({
        is_flagged: false,
        labels: ['clean'],
        confidence: 0.98,
        decision_source: 'model',
      }),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toBeNull();
    expect(cacheService.setModerationFastResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ is_flagged: false }),
      86400,
    );
    expect(metrics.recordOutcome).toHaveBeenCalledWith('allow_llm', 'group');
  });

  it('LLM flagged but BELOW threshold → null (semantic lock-in)', async () => {
    // Confidence semantics: a flagged result with confidence < threshold
    // is treated as ALLOW. This test locks in the design decision.
    const { service, metrics } = makeService({
      llmCheck: jest.fn().mockResolvedValue({
        is_flagged: true,
        labels: ['toxic'],
        confidence: 0.5,
        decision_source: 'model',
      }),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toBeNull();
    expect(metrics.recordOutcome).toHaveBeenCalledWith('allow_llm', 'group');
  });

  it('LLM flagged at threshold → rejection + block cache populated with 15min TTL', async () => {
    const { service, cacheService, metrics } = makeService({
      llmCheck: jest.fn().mockResolvedValue({
        is_flagged: true,
        labels: ['toxic'],
        confidence: 0.96,
        decision_source: 'model',
      }),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toMatchObject({
      reason: 'moderation',
      labels: ['toxic'],
      confidence: 0.96,
    });
    expect(cacheService.setModerationFastResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ is_flagged: true }),
      900,
    );
    expect(metrics.recordOutcome).toHaveBeenCalledWith('block', 'group');
  });

  it('LLM timeout (AbortError) → null + fail_open with reason=timeout', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const { service, metrics } = makeService({
      llmCheck: jest.fn().mockRejectedValue(abortErr),
    });

    const result = await service.checkOrAllow(DEFAULT_INPUT);

    expect(result).toBeNull();
    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'fail_open',
      'group',
      'timeout',
    );
  });

  it('LLM 5xx response → null + fail_open with reason=http_error', async () => {
    const axiosErr = new AxiosError('500 server error');
    axiosErr.response = { status: 500 } as AxiosResponse;
    const { service, metrics } = makeService({
      llmCheck: jest.fn().mockRejectedValue(axiosErr),
    });

    await service.checkOrAllow(DEFAULT_INPUT);

    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'fail_open',
      'group',
      'http_error',
    );
  });

  it('LLM network error → null + fail_open with reason=network_error', async () => {
    // No .response, not an AbortError → classified as network.
    const networkErr = new Error('ECONNREFUSED');
    const { service, metrics } = makeService({
      llmCheck: jest.fn().mockRejectedValue(networkErr),
    });

    await service.checkOrAllow(DEFAULT_INPUT);

    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      'fail_open',
      'group',
      'network_error',
    );
  });
});
