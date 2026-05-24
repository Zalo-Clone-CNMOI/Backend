import { Test } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { AiCoreClientService } from './ai-core-client.service';
import { EntityInfoApi, ZaiAssistApi } from './client';
import type {
  AiEntityInfoResultEvent,
  AiCatchUpResultEvent,
  AiTranslateResultEvent,
} from '@libs/contracts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_INFO_FIXTURE: AiEntityInfoResultEvent = {
  entity_text: 'React',
  entity_type: 'tool',
  title: 'React',
  summary: 'A JavaScript library for building UIs.',
  details: 'Developed by Meta.',
  related_entities: ['Vue', 'Angular'],
  provider: 'openai',
  tokens_used: 120,
  processed_at: 1_700_000_000_000,
};

const CATCH_UP_FIXTURE: AiCatchUpResultEvent = {
  conversation_id: 'conv-1',
  user_id: 'user-1',
  had_unread: true,
  summary: 'You missed 5 messages about the project deadline.',
  message_count: 5,
  from_message_id: 'msg-1',
  to_message_id: 'msg-5',
  since: 1_700_000_000_000,
  truncated: false,
  provider: 'openai',
  tokens_used: 80,
  cached: false,
  generated_at: 1_700_000_100_000,
};

const TRANSLATE_FIXTURE: AiTranslateResultEvent = {
  message_id: 'msg-1',
  conversation_id: 'conv-1',
  user_id: 'user-1',
  original_body: 'Hello',
  translated_body: 'Xin chào',
  source_language: 'en',
  target_language: 'vi',
  provider: 'openai',
  tokens_used: 10,
  cached: false,
  processed_at: 1_700_000_200_000,
};

// ── Mock factories ─────────────────────────────────────────────────────────────

const mockEntityInfoApi = {
  getEntityInfo: jest.fn(),
};

const mockZaiAssistApi = {
  getCatchUpSummary: jest.fn(),
  translate: jest.fn(),
};

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('AiCoreClientService', () => {
  let service: AiCoreClientService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        AiCoreClientService,
        { provide: EntityInfoApi, useValue: mockEntityInfoApi },
        { provide: ZaiAssistApi, useValue: mockZaiAssistApi },
      ],
    }).compile();

    service = module.get(AiCoreClientService);
  });

  // ── getEntityInfo ──────────────────────────────────────────────────────────

  describe('getEntityInfo', () => {
    it('returns response.data on success', async () => {
      mockEntityInfoApi.getEntityInfo.mockResolvedValue({
        data: ENTITY_INFO_FIXTURE,
      });

      const result = await service.getEntityInfo({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-1',
      });

      expect(result).toEqual(ENTITY_INFO_FIXTURE);
      expect(mockEntityInfoApi.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        user_id: 'user-1',
      });
    });

    it('calls handleError and throws when the api rejects', async () => {
      const axiosErr = new AxiosError('AI unavailable');
      mockEntityInfoApi.getEntityInfo.mockRejectedValue(axiosErr);

      await expect(
        service.getEntityInfo({
          text: 'React',
          type: 'tool',
          lang: 'vi',
          userId: 'user-1',
        }),
      ).rejects.toThrow();
    });
  });

  // ── getCatchUpSummary ──────────────────────────────────────────────────────

  describe('getCatchUpSummary', () => {
    it('maps camelCase params to snake_case and returns response.data', async () => {
      mockZaiAssistApi.getCatchUpSummary.mockResolvedValue({
        data: CATCH_UP_FIXTURE,
      });

      const result = await service.getCatchUpSummary({
        conversationId: 'conv-1',
        userId: 'user-1',
        since: 1_700_000_000_000,
        limit: 20,
      });

      expect(result).toEqual(CATCH_UP_FIXTURE);
      expect(mockZaiAssistApi.getCatchUpSummary).toHaveBeenCalledWith({
        conversation_id: 'conv-1',
        user_id: 'user-1',
        since: 1_700_000_000_000,
        limit: 20,
      });
    });

    it('omits optional params when not provided', async () => {
      mockZaiAssistApi.getCatchUpSummary.mockResolvedValue({
        data: { ...CATCH_UP_FIXTURE, had_unread: false, summary: '' },
      });

      await service.getCatchUpSummary({
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      expect(mockZaiAssistApi.getCatchUpSummary).toHaveBeenCalledWith({
        conversation_id: 'conv-2',
        user_id: 'user-2',
        since: undefined,
        limit: undefined,
      });
    });

    it('calls handleError and throws when the api rejects', async () => {
      const axiosErr = new AxiosError('ai-core unreachable');
      mockZaiAssistApi.getCatchUpSummary.mockRejectedValue(axiosErr);

      await expect(
        service.getCatchUpSummary({
          conversationId: 'conv-1',
          userId: 'user-1',
        }),
      ).rejects.toThrow();
    });
  });

  // ── translate ──────────────────────────────────────────────────────────────

  describe('translate', () => {
    it('maps camelCase params to snake_case and returns response.data', async () => {
      mockZaiAssistApi.translate.mockResolvedValue({
        data: TRANSLATE_FIXTURE,
      });

      const result = await service.translate({
        text: 'Hello',
        targetLanguage: 'vi',
        sourceLanguage: 'en',
        userId: 'user-1',
      });

      expect(result).toEqual(TRANSLATE_FIXTURE);
      expect(mockZaiAssistApi.translate).toHaveBeenCalledWith({
        text: 'Hello',
        target_language: 'vi',
        source_language: 'en',
        user_id: 'user-1',
      });
    });

    it('omits source_language when not provided', async () => {
      mockZaiAssistApi.translate.mockResolvedValue({
        data: TRANSLATE_FIXTURE,
      });

      await service.translate({
        text: 'Hello',
        targetLanguage: 'vi',
        userId: 'user-1',
      });

      expect(mockZaiAssistApi.translate).toHaveBeenCalledWith({
        text: 'Hello',
        target_language: 'vi',
        source_language: undefined,
        user_id: 'user-1',
      });
    });

    it('calls handleError and throws when the api rejects', async () => {
      const axiosErr = new AxiosError('translate failed');
      mockZaiAssistApi.translate.mockRejectedValue(axiosErr);

      await expect(
        service.translate({
          text: 'Hello',
          targetLanguage: 'vi',
          userId: 'user-1',
        }),
      ).rejects.toThrow();
    });
  });
});
