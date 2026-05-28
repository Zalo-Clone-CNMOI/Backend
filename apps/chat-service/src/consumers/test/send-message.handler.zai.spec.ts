/**
 * Unit tests for SendMessageHandler — Zai routing (Phase 4).
 *
 * Split out of send-message.handler.spec.ts to respect the per-file
 * `max-lines` lint cap. Setup is shared via send-message.handler.harness.ts.
 */
import type { SendMessageHandler } from '../send-message.handler';
import { createMockChatSendCommand } from '../../../../../test/helpers';
import {
  ZAI_BOT_ID,
  createHandlerHarness,
  type CacheServiceMock,
  type MembershipServiceMock,
  type PublisherMock,
  type RepoMock,
} from './send-message.handler.harness';

describe('SendMessageHandler — Zai routing (Phase 4)', () => {
  let handler: SendMessageHandler;
  let repo: RepoMock;
  let publisher: PublisherMock;
  let cacheService: CacheServiceMock;
  let membershipService: MembershipServiceMock;

  beforeEach(() => {
    const h = createHandlerHarness();
    handler = h.handler;
    repo = h.repo;
    publisher = h.publisher;
    cacheService = h.cacheService;
    membershipService = h.membershipService;
  });

  /**
   * handlePostMessagePersist runs *all* fire-and-forget tasks in parallel via
   * void IIFEs. We assert by inspecting publisher.emit calls after waiting a
   * microtask tick for the async work to complete.
   */
  const drainMicrotasks = async () => {
    // Two ticks: one for the IIFE to start, one for getAiConversationContext to resolve.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('AI conversation: emits AiZaiChatRequest with ai_context + trigger=conversation', async () => {
    const payload = createMockChatSendCommand();
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0][1]).toMatchObject({
      conversation_id: payload.conversation_id,
      sender_id: payload.sender_id,
      ai_context: { feature: 'general' },
      trigger: 'conversation',
    });
  });

  it('AI conversation + image attachment: forwards images[] to Zai (vision)', async () => {
    const payload = createMockChatSendCommand({
      body: 'what is this?',
      attachments: [
        {
          key: 'uploads/abc.png',
          type: 'image',
          name: 'abc.png',
          size: 1234,
          content_type: 'image/png',
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0][1]).toMatchObject({
      trigger: 'conversation',
      images: [{ key: 'uploads/abc.png', content_type: 'image/png' }],
    });
  });

  it('Image-only message (no body) in AI conversation: still triggers Zai', async () => {
    const payload = createMockChatSendCommand({
      body: '',
      attachments: [
        {
          key: 'uploads/x.png',
          type: 'image',
          name: 'x.png',
          size: 10,
          content_type: 'image/png',
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0][1]).toMatchObject({
      images: [{ key: 'uploads/x.png', content_type: 'image/png' }],
    });
  });

  it('Image-only message in a DOCUMENT conversation: skips Zai (RAG needs a query)', async () => {
    const payload = createMockChatSendCommand({
      body: '',
      attachments: [
        {
          key: 'uploads/x.png',
          type: 'image',
          name: 'x.png',
          size: 10,
          content_type: 'image/png',
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
  });

  it('Image + caption in a DOCUMENT conversation: still triggers (has a query)', async () => {
    const payload = createMockChatSendCommand({
      body: 'what does the diagram on page 2 mean?',
      attachments: [
        {
          key: 'uploads/x.png',
          type: 'image',
          name: 'x.png',
          size: 10,
          content_type: 'image/png',
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
  });

  it('Non-image media only (no body): does NOT trigger Zai', async () => {
    const payload = createMockChatSendCommand({
      body: '',
      attachments: [
        {
          key: 'uploads/clip.mp4',
          type: 'video',
          name: 'clip.mp4',
          size: 99,
          content_type: 'video/mp4',
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
  });

  it('Group @Zai mention: emits AiZaiChatRequest with trigger=mention when cooldown free', async () => {
    const payload = createMockChatSendCommand({
      mentions: [
        {
          user_id: ZAI_BOT_ID,
          mention_type: 'user',
          offset: 0,
          length: 4,
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue(null);
    cacheService.acquireZaiMentionCooldown.mockResolvedValue(true);

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0][1]).toMatchObject({
      trigger: 'mention',
    });
    expect(aiCalls[0][1]).not.toHaveProperty('ai_context');
    // C9: cooldown is acquired per-(conversation, user), not conversation-wide.
    expect(cacheService.acquireZaiMentionCooldown).toHaveBeenCalledWith(
      payload.conversation_id,
      payload.sender_id,
    );
  });

  it('Group @Zai mention rate-limited: skips emit when cooldown busy', async () => {
    const payload = createMockChatSendCommand({
      mentions: [
        {
          user_id: ZAI_BOT_ID,
          mention_type: 'user',
          offset: 0,
          length: 4,
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue(null);
    cacheService.acquireZaiMentionCooldown.mockResolvedValue(false);

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
  });

  it('Mutual exclusion: AI conversation AND @Zai mention → only conversation path fires', async () => {
    const payload = createMockChatSendCommand({
      mentions: [
        {
          user_id: ZAI_BOT_ID,
          mention_type: 'user',
          offset: 0,
          length: 4,
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'document',
      document_id: 'doc-x',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0][1]).toMatchObject({ trigger: 'conversation' });
    expect(cacheService.acquireZaiMentionCooldown).not.toHaveBeenCalled();
  });

  it('Loop guard: Zai bot sender → no AiZaiChatRequest emitted', async () => {
    const payload = createMockChatSendCommand({
      sender_id: ZAI_BOT_ID,
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
  });

  it('Empty body in AI conversation → no AiZaiChatRequest emit + getAiConversationContext skipped', async () => {
    const payload = createMockChatSendCommand({
      body: '',
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    // Even though context check WOULD return AI conv, the guard short-circuits
    // before the lookup runs.
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
    expect(cacheService.getAiConversationContext).not.toHaveBeenCalled();
  });

  it('Whitespace-only body in AI conversation → no AiZaiChatRequest emit', async () => {
    const payload = createMockChatSendCommand({
      body: '   \n\t  ',
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue({
      feature: 'general',
      created_at: 1,
    });

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
  });

  it('Empty body + @Zai mention → no AiZaiChatRequest emit + cooldown not consumed', async () => {
    const payload = createMockChatSendCommand({
      body: '',
      mentions: [
        {
          user_id: ZAI_BOT_ID,
          mention_type: 'user',
          offset: 0,
          length: 4,
        },
      ],
    } as Partial<Parameters<typeof createMockChatSendCommand>[0]>);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    repo.tryBeginMessageProcessing.mockResolvedValue(true);
    repo.insertMessage.mockResolvedValue(undefined);
    repo.markMessageStored.mockResolvedValue(undefined);
    cacheService.getAiConversationContext.mockResolvedValue(null);

    await handler.handle(payload);
    await drainMicrotasks();

    const aiCalls = (publisher.emit.mock.calls as [string, unknown][]).filter(
      ([topic]) => topic === 'ai.zai.chat.request',
    );
    expect(aiCalls).toHaveLength(0);
    expect(cacheService.acquireZaiMentionCooldown).not.toHaveBeenCalled();
  });
});
