import { Test, TestingModule } from '@nestjs/testing';
import { AiAssistService } from './ai-assist.service';
import { AiCoreClientService } from '@app/clients';
import { InteractionClientService } from '@app/clients/interaction-client';
import type { AiCatchUpResultEvent } from '@libs/contracts';
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

// The runtime interaction-service response carries `mySettings.lastReadAt`,
// but the generated ConversationDetailDto type is stale and omits it — so the
// test attaches it via a cast, matching how the service reads it.
const mockConversationDetailWithLastRead = (
  lastReadAt: string | null,
): ConversationDetailDto =>
  ({
    ...mockConversationDetail(),
    mySettings: { lastReadAt },
  }) as unknown as ConversationDetailDto;

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
            getOrCreateZaiConversation: jest.fn(),
          },
        },
        {
          provide: AiCoreClientService,
          useValue: {
            getCatchUpSummary: jest.fn(),
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
    it('happy path: passes lastReadAt as `since` (ms) and returns camelCase DTO', async () => {
      const lastReadAt = '2026-05-20T10:00:00.000Z';
      interactionClient.getConversationById.mockResolvedValue(
        mockConversationDetailWithLastRead(lastReadAt),
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
        since: new Date(lastReadAt).getTime(),
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

    it('lastReadAt null (never read) → since is undefined in getCatchUpSummary call', async () => {
      interactionClient.getConversationById.mockResolvedValue(
        mockConversationDetailWithLastRead(null),
      );
      aiCoreClient.getCatchUpSummary.mockResolvedValue(mockCatchUpResult());

      await service.catchUp('token-abc', 'user-1', 'conv-1');

      const callArgs = aiCoreClient.getCatchUpSummary.mock.calls[0][0];
      expect(callArgs.since).toBeUndefined();
    });

    it('mySettings absent (stale client shape) → since is undefined', async () => {
      interactionClient.getConversationById.mockResolvedValue(
        mockConversationDetail(),
      );
      aiCoreClient.getCatchUpSummary.mockResolvedValue(mockCatchUpResult());

      await service.catchUp('token-abc', 'user-1', 'conv-1');

      const callArgs = aiCoreClient.getCatchUpSummary.mock.calls[0][0];
      expect(callArgs.since).toBeUndefined();
    });
  });

  // ── getOrCreateZaiConversation ─────────────────────────────────────────────

  describe('getOrCreateZaiConversation', () => {
    it('delegates to interactionClient and returns conversationId DTO', async () => {
      (
        interactionClient as unknown as {
          getOrCreateZaiConversation: jest.Mock;
        }
      ).getOrCreateZaiConversation.mockResolvedValue({
        conversationId: 'conv-zai-1',
      });

      const result = await service.getOrCreateZaiConversation('bearer-token');

      expect(
        (
          interactionClient as unknown as {
            getOrCreateZaiConversation: jest.Mock;
          }
        ).getOrCreateZaiConversation,
      ).toHaveBeenCalledWith('bearer-token');
      expect(result.conversationId).toBe('conv-zai-1');
    });

    it('propagates error when interactionClient throws', async () => {
      (
        interactionClient as unknown as {
          getOrCreateZaiConversation: jest.Mock;
        }
      ).getOrCreateZaiConversation.mockRejectedValue(
        new Error('network error'),
      );

      await expect(
        service.getOrCreateZaiConversation('bad-token'),
      ).rejects.toThrow('network error');
    });
  });
});
