import { Test, TestingModule } from '@nestjs/testing';
import { AiAssistService } from './ai-assist.service';
import { AiCoreClientService } from '@app/clients';
import { InteractionClientService } from '@app/clients/interaction-client';
import type {
  AiCatchUpResultEvent,
  AiTranslateResultEvent,
} from '@libs/contracts';
import {
  type ConversationDetailDto,
  ConversationDetailDtoTypeEnum,
} from '@app/clients/interaction-client';

// ── helpers ────────────────────────────────────────────────────────────────

const mockConversationDetail = (): ConversationDetailDto => ({
  id: 'conv-1',
  type: ConversationDetailDtoTypeEnum.group,
  name: 'Test Group',
  members: [],
});

const mockCatchUpResult = (): AiCatchUpResultEvent => ({
  conversation_id: 'conv-1',
  user_id: 'user-1',
  had_unread: true,
  summary: 'There were 3 new messages about the project.',
  message_count: 3,
  from_message_id: 'msg-1',
  to_message_id: 'msg-3',
  since: undefined,
  truncated: false,
  provider: 'openai',
  tokens_used: 80,
  cached: false,
  generated_at: 1700000000000,
});

const mockTranslateResult = (): AiTranslateResultEvent => ({
  message_id: '',
  conversation_id: '',
  user_id: 'user-1',
  original_body: 'Hello world',
  translated_body: 'Xin chào thế giới',
  source_language: 'en',
  target_language: 'vi',
  provider: 'openai',
  tokens_used: 20,
  cached: false,
  processed_at: 1700000001000,
});

// ── test suite ──────────────────────────────────────────────────────────────

describe('AiAssistService', () => {
  let service: AiAssistService;
  let interactionClient: jest.Mocked<InteractionClientService>;
  let aiCoreClient: jest.Mocked<AiCoreClientService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAssistService,
        {
          provide: InteractionClientService,
          useValue: {
            getConversationById: jest.fn(),
          },
        },
        {
          provide: AiCoreClientService,
          useValue: {
            getCatchUpSummary: jest.fn(),
            translate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiAssistService>(AiAssistService);
    interactionClient = module.get(InteractionClientService);
    aiCoreClient = module.get(AiCoreClientService);
  });

  // ── catchUp ──────────────────────────────────────────────────────────────

  describe('catchUp', () => {
    it('happy path: calls interactionClient then aiCoreClient and returns camelCase DTO', async () => {
      interactionClient.getConversationById.mockResolvedValue(
        mockConversationDetail(),
      );
      aiCoreClient.getCatchUpSummary.mockResolvedValue(mockCatchUpResult());

      const result = await service.catchUp('token-abc', 'user-1', 'conv-1');

      expect(interactionClient.getConversationById).toHaveBeenCalledWith(
        'token-abc',
        'conv-1',
      );
      expect(aiCoreClient.getCatchUpSummary).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        userId: 'user-1',
        since: undefined,
      });

      expect(result.hadUnread).toBe(true);
      expect(result.messageCount).toBe(3);
      expect(result.summary).toBe(
        'There were 3 new messages about the project.',
      );
      expect(result.fromMessageId).toBe('msg-1');
      expect(result.toMessageId).toBe('msg-3');
      expect(result.truncated).toBe(false);
      expect(result.provider).toBe('openai');
      expect(result.cached).toBe(false);
      expect(result.generatedAt).toBe(1700000000000);
    });

    it('non-member: interactionClient throws → error propagates, aiCoreClient is never called', async () => {
      const forbidden = Object.assign(new Error('Forbidden'), {
        response: { status: 403 },
      });
      interactionClient.getConversationById.mockRejectedValue(forbidden);

      await expect(
        service.catchUp('bad-token', 'user-2', 'conv-1'),
      ).rejects.toThrow('Forbidden');

      expect(aiCoreClient.getCatchUpSummary).not.toHaveBeenCalled();
    });

    it('lastReadAt not available → since is undefined in getCatchUpSummary call', async () => {
      interactionClient.getConversationById.mockResolvedValue(
        mockConversationDetail(),
      );
      aiCoreClient.getCatchUpSummary.mockResolvedValue(mockCatchUpResult());

      await service.catchUp('token-abc', 'user-1', 'conv-1');

      const callArgs = aiCoreClient.getCatchUpSummary.mock.calls[0][0];
      expect(callArgs.since).toBeUndefined();
    });
  });

  // ── translate ─────────────────────────────────────────────────────────────

  describe('translate', () => {
    it('happy path: calls aiCoreClient.translate with mapped params and returns camelCase DTO', async () => {
      aiCoreClient.translate.mockResolvedValue(mockTranslateResult());

      const dto = {
        text: 'Hello world',
        targetLanguage: 'vi',
        sourceLanguage: 'en',
      };
      const result = await service.translate('user-1', dto);

      expect(aiCoreClient.translate).toHaveBeenCalledWith({
        text: 'Hello world',
        targetLanguage: 'vi',
        sourceLanguage: 'en',
        userId: 'user-1',
      });

      expect(result.originalBody).toBe('Hello world');
      expect(result.translatedBody).toBe('Xin chào thế giới');
      expect(result.sourceLanguage).toBe('en');
      expect(result.targetLanguage).toBe('vi');
      expect(result.provider).toBe('openai');
      expect(result.cached).toBe(false);
    });

    it('translate without optional sourceLanguage → passes undefined to aiCoreClient', async () => {
      aiCoreClient.translate.mockResolvedValue(mockTranslateResult());

      const dto = { text: 'Hi', targetLanguage: 'vi' };
      await service.translate('user-1', dto);

      const callArgs = aiCoreClient.translate.mock.calls[0][0];
      expect(callArgs.sourceLanguage).toBeUndefined();
    });
  });
});
