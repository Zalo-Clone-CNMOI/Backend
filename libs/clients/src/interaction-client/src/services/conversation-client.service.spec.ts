import { ConversationClientService } from './conversation-client.service';
import type { ConversationsApi, AiConversationsApi } from '../client/generated';

/**
 * The extraction (Phase 6 C13) is a pure move, so these tests just lock the
 * thin call/auth-header wiring for a representative conversation method, an AI
 * method, and the shared error path.
 */
describe('ConversationClientService', () => {
  let conversationsApi: jest.Mocked<ConversationsApi>;
  let aiConversationsApi: jest.Mocked<AiConversationsApi>;
  let service: ConversationClientService;

  beforeEach(() => {
    conversationsApi = {
      getConversations: jest.fn(),
      disbandConversation: jest.fn(),
    } as unknown as jest.Mocked<ConversationsApi>;
    aiConversationsApi = {
      disbandAiConversation: jest.fn(),
    } as unknown as jest.Mocked<AiConversationsApi>;
    service = new ConversationClientService(
      conversationsApi,
      aiConversationsApi,
    );
  });

  it('getConversations forwards the bearer token and returns data', async () => {
    (conversationsApi.getConversations as jest.Mock).mockResolvedValue({
      data: { items: [] },
    });

    const result = await service.getConversations('tok', 1, 20);

    expect(conversationsApi.getConversations).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      { headers: { Authorization: 'Bearer tok' } },
    );
    expect(result).toEqual({ items: [] });
  });

  it('disbandAiConversation forwards to the AI API and returns the message', async () => {
    (aiConversationsApi.disbandAiConversation as jest.Mock).mockResolvedValue({
      data: { message: 'AI conversation disbanded successfully' },
    });

    const result = await service.disbandAiConversation('tok', 'conv-ai');

    expect(aiConversationsApi.disbandAiConversation).toHaveBeenCalledWith(
      { conversationId: 'conv-ai' },
      { headers: { Authorization: 'Bearer tok' } },
    );
    expect(result.message).toBe('AI conversation disbanded successfully');
  });

  it('propagates errors through handleError', async () => {
    (conversationsApi.disbandConversation as jest.Mock).mockRejectedValue(
      new Error('boom'),
    );

    await expect(
      service.disbandConversation('tok', 'conv-1'),
    ).rejects.toThrow();
  });
});

describe('InteractionClientService delegation', () => {
  it('delegates conversation + AI methods to ConversationClientService', async () => {
    // Lazy import to avoid pulling generated API types into the spec scope.
    const { InteractionClientService } =
      await import('../interaction-client.service');

    const conversationClient = {
      getConversations: jest.fn().mockResolvedValue({ items: [] }),
      disbandAiConversation: jest.fn().mockResolvedValue({ message: 'ok' }),
    };

    const facade = new InteractionClientService(
      {} as never,
      {} as never,
      conversationClient as never,
    );

    await facade.getConversations('tok', 2, 10);
    await facade.disbandAiConversation('tok', 'conv-ai');

    expect(conversationClient.getConversations).toHaveBeenCalledWith(
      'tok',
      2,
      10,
    );
    expect(conversationClient.disbandAiConversation).toHaveBeenCalledWith(
      'tok',
      'conv-ai',
    );
  });
});
