import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { EntityDetectionEngine } from './entity-detection.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { AiEntityDetectionLog } from '@libs/database/entities';

function makeGateway(): jest.Mocked<AiGatewayService> {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics(): jest.Mocked<AiMetricsService> {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRepo() {
  return {
    create: jest.fn((data: object) => data),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function llmResult(content: string) {
  return {
    content,
    tokensIn: 50,
    tokensOut: 30,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 100,
  };
}

describe('EntityDetectionEngine', () => {
  let engine: EntityDetectionEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();
    repo = makeRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityDetectionEngine,
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
        { provide: getRepositoryToken(AiEntityDetectionLog), useValue: repo },
      ],
    }).compile();

    engine = module.get(EntityDetectionEngine);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('detect()', () => {
    const baseEvent = {
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      body: 'Tôi dùng Telegram và Figma mỗi ngày',
      created_at: Date.now(),
    };

    it('returns entities from LLM and persists log', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            entities: [
              { text: 'Telegram', type: 'tool', confidence: 0.95 },
              { text: 'Figma', type: 'tool', confidence: 0.9 },
            ],
          }),
        ),
      );

      const result = await engine.detect(baseEvent);

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]).toEqual({
        text: 'Telegram',
        type: 'tool',
        confidence: 0.95,
      });
      expect(repo.save).toHaveBeenCalled();
    });

    it('filters entities below confidence threshold (0.75)', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            entities: [
              { text: 'Telegram', type: 'tool', confidence: 0.95 },
              { text: 'mỗi', type: 'concept', confidence: 0.5 },
              { text: 'Figma', type: 'tool', confidence: 0.74 },
            ],
          }),
        ),
      );

      const result = await engine.detect(baseEvent);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].text).toBe('Telegram');
    });

    it('filters entities whose text does not appear in the message body', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            entities: [
              { text: 'Telegram', type: 'tool', confidence: 0.9 },
              { text: 'WhatsApp', type: 'tool', confidence: 0.95 },
            ],
          }),
        ),
      );

      const result = await engine.detect(baseEvent);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].text).toBe('Telegram');
    });

    it('falls back to "other" for unknown entity types', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            entities: [{ text: 'Telegram', type: 'invalid', confidence: 0.9 }],
          }),
        ),
      );

      const result = await engine.detect(baseEvent);

      expect(result.entities[0].type).toBe('other');
    });

    it('returns empty entities on LLM failure', async () => {
      gateway.complete.mockRejectedValue(new Error('LLM down'));

      const result = await engine.detect(baseEvent);

      expect(result.entities).toEqual([]);
      expect(result.tokens_used).toBe(0);
      expect(result.provider).toBe('openai');
    });

    it('returns empty entities on malformed JSON', async () => {
      gateway.complete.mockResolvedValue(llmResult('not json'));

      const result = await engine.detect(baseEvent);

      expect(result.entities).toEqual([]);
    });

    it('strips markdown fences before parsing', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          '```json\n{"entities":[{"text":"Telegram","type":"tool","confidence":0.9}]}\n```',
        ),
      );

      const result = await engine.detect(baseEvent);

      expect(result.entities).toHaveLength(1);
    });

    it('retries once when first response is malformed and recovers entities', async () => {
      gateway.complete
        .mockResolvedValueOnce(
          llmResult(
            'Sure! Here are the entities: this is not valid JSON at all.',
          ),
        )
        .mockResolvedValueOnce(
          llmResult(
            JSON.stringify({
              entities: [{ text: 'Telegram', type: 'tool', confidence: 0.9 }],
            }),
          ),
        );

      const result = await engine.detect(baseEvent);

      expect(gateway.complete).toHaveBeenCalledTimes(2);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].text).toBe('Telegram');

      expect(result.tokens_used).toBe(160);
    });

    it('does NOT retry when first response is legitimately empty', async () => {
      gateway.complete.mockResolvedValueOnce(
        llmResult(JSON.stringify({ entities: [] })),
      );

      const result = await engine.detect(baseEvent);

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.entities).toEqual([]);
    });

    it('does NOT retry when JSON has entities key but array is empty', async () => {
      gateway.complete.mockResolvedValueOnce(
        llmResult(JSON.stringify({ entities: [], notes: 'no entities found' })),
      );

      const result = await engine.detect(baseEvent);

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.entities).toEqual([]);
    });

    it('returns empty when both initial call and retry fail to parse', async () => {
      gateway.complete
        .mockResolvedValueOnce(llmResult('garbage response one'))
        .mockResolvedValueOnce(llmResult('garbage response two'));

      const result = await engine.detect(baseEvent);

      expect(gateway.complete).toHaveBeenCalledTimes(2);
      expect(result.entities).toEqual([]);
    });

    it('records retry conversation includes original assistant message and corrective user message', async () => {
      const malformed = 'I think the entities are Telegram and Figma';
      gateway.complete
        .mockResolvedValueOnce(llmResult(malformed))
        .mockResolvedValueOnce(llmResult(JSON.stringify({ entities: [] })));

      await engine.detect(baseEvent);

      expect(gateway.complete).toHaveBeenCalledTimes(2);
      const retryMessages = gateway.complete.mock.calls[1][1].messages;

      const assistantMsg = retryMessages.find(
        (m: { role: string }) => m.role === 'assistant',
      );
      expect(assistantMsg?.content).toBe(malformed);
      const lastUserMsg = retryMessages[retryMessages.length - 1];
      expect(lastUserMsg.role).toBe('user');
      expect(lastUserMsg.content).toMatch(/not valid JSON|valid JSON/i);
    });

    it('records failure metric (success=false) when both retries fail to parse', async () => {
      gateway.complete
        .mockResolvedValueOnce(llmResult('garbage one'))
        .mockResolvedValueOnce(llmResult('garbage two'));

      await engine.detect(baseEvent);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'entity_detection',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        false,
      );
    });

    it('sums latencyMs across both calls when retry happens', async () => {
      gateway.complete
        .mockResolvedValueOnce({ ...llmResult('garbage'), latencyMs: 100 })
        .mockResolvedValueOnce({
          ...llmResult(
            JSON.stringify({
              entities: [{ text: 'Telegram', type: 'tool', confidence: 0.9 }],
            }),
          ),
          latencyMs: 150,
        });

      await engine.detect(baseEvent);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'entity_detection',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        250,
        true,
      );
    });
  });

  describe('generateInfo()', () => {
    const baseEvent = {
      entity_text: 'Telegram',
      entity_type: 'tool' as const,
      user_id: 'user-1',
      language: 'vi',
    };

    it('returns parsed info from LLM', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            title: 'Telegram',
            summary: 'Ứng dụng nhắn tin tức thời',
            details: 'Telegram là ứng dụng...',
            related_entities: ['WhatsApp', 'Signal'],
          }),
        ),
      );

      const result = await engine.generateInfo(baseEvent);

      expect(result.title).toBe('Telegram');
      expect(result.summary).toBe('Ứng dụng nhắn tin tức thời');
      expect(result.related_entities).toEqual(['WhatsApp', 'Signal']);
    });

    it('uses entity_text as fallback title on parse failure', async () => {
      gateway.complete.mockResolvedValue(llmResult('not json'));

      const result = await engine.generateInfo(baseEvent);

      expect(result.title).toBe('Telegram');
      expect(result.summary).toBe('');
    });

    it('returns fallback response on LLM failure', async () => {
      gateway.complete.mockRejectedValue(new Error('LLM down'));

      const result = await engine.generateInfo(baseEvent);

      expect(result.entity_text).toBe('Telegram');
      expect(result.title).toBe('Telegram');
      expect(result.summary).toContain('Unable to generate');
      expect(result.tokens_used).toBe(0);
    });

    it('filters non-string related_entities', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(
          JSON.stringify({
            title: 'Telegram',
            summary: 's',
            details: 'd',
            related_entities: ['Signal', 42, null, 'WhatsApp'],
          }),
        ),
      );

      const result = await engine.generateInfo(baseEvent);

      expect(result.related_entities).toEqual(['Signal', 'WhatsApp']);
    });

    it('defaults language to vi when not provided', async () => {
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ title: 't', summary: 's', details: 'd' })),
      );

      await engine.generateInfo({
        entity_text: 'Telegram',
        entity_type: 'tool',
        user_id: 'user-1',
      });

      const calledMessages = gateway.complete.mock.calls[0][1].messages;
      const systemMsg = calledMessages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain('Vietnamese');
    });
  });
});
