/**
 * Unit tests for PersistMessageConsumer (chat-service)
 *
 * Covers: TC-SVC-001, TC-SVC-002, TC-KAFKA-002, TC-KAFKA-003, TC-DB-004
 * - Message deduplication via idempotency table
 * - Membership re-check before persist
 * - Message persist → event emit flow
 * - Edit message
 * - Delete message (soft)
 * - Reaction add (with replace semantics)
 * - Reaction remove
 * - AI moderation trigger (non-blocking)
 * - Cache invalidation (non-blocking)
 */
import { PersistMessageConsumer } from './persist-message.consumer';
import { createMockChatSendCommand } from '../../../../test/helpers';

describe('PersistMessageConsumer', () => {
  type InternalLogger = {
    debug: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  let consumer: PersistMessageConsumer;
  let repo: {
    wasMessageSeen: jest.Mock;
    insertMessage: jest.Mock;
    markMessageSeen: jest.Mock;
    updateMessageBody: jest.Mock;
    softDeleteMessage: jest.Mock;
    getReactionsByUser: jest.Mock;
    addReaction: jest.Mock;
    removeReaction: jest.Mock;
  };
  let publisher: { emit: jest.Mock };
  let cacheService: { invalidateRecentMessages: jest.Mock };
  let membershipService: { canUserAccessConversation: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(() => {
    repo = {
      wasMessageSeen: jest.fn(),
      insertMessage: jest.fn(),
      markMessageSeen: jest.fn(),
      updateMessageBody: jest.fn(),
      softDeleteMessage: jest.fn(),
      getReactionsByUser: jest.fn(),
      addReaction: jest.fn(),
      removeReaction: jest.fn(),
    };

    publisher = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    cacheService = {
      invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    membershipService = {
      canUserAccessConversation: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    conversationMemberRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    consumer = new PersistMessageConsumer(
      repo as unknown,
      publisher as unknown,
      cacheService as unknown,
      membershipService as unknown,
      userRepo as unknown,
      conversationMemberRepo as unknown,
    );

    const internalLogger = (consumer as { logger: InternalLogger }).logger;
    jest.spyOn(internalLogger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'error').mockImplementation(() => undefined);
  });

  // ─── onSend: Happy Path ────────────────────────────────────────────────────

  describe('onSend — happy path (TC-KAFKA-002)', () => {
    it('should persist message and emit ChatMessageCreated event', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(false);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageSeen.mockResolvedValue(undefined);

      await consumer.onSend(payload as unknown);

      expect(membershipService.canUserAccessConversation).toHaveBeenCalledWith(
        payload.sender_id,
        payload.conversation_id,
      );
      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
        }),
      );
      expect(repo.markMessageSeen).toHaveBeenCalledWith(
        payload.message_id,
        payload.conversation_id,
        expect.any(Number),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
        }),
      );
    });
  });

  // ─── onSend: Idempotency ──────────────────────────────────────────────────

  describe('onSend — idempotency (TC-SVC-001, TC-KAFKA-003, TC-DB-004)', () => {
    it('should skip duplicate message (already seen)', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(true); // duplicate!

      await consumer.onSend(payload as unknown);

      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(repo.markMessageSeen).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  // ─── onSend: Membership Re-Check ──────────────────────────────────────────

  describe('onSend — membership re-check (TC-SVC-002)', () => {
    it('should block unauthorized sender (not a member)', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(false);

      await consumer.onSend(payload as unknown);

      expect(repo.wasMessageSeen).not.toHaveBeenCalled();
      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  // ─── onSend: AI Moderation Trigger ─────────────────────────────────────────

  describe('onSend — AI moderation (non-blocking)', () => {
    it('should trigger AI moderation request after message persist', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(false);

      await consumer.onSend(payload as unknown);

      // Publisher should have been called at least twice:
      // 1. ChatMessageCreated
      // 2. AiModerationRequest (async)
      // We need to wait for the async fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 50));

      const emitCalls = publisher.emit.mock.calls;
      expect(
        emitCalls.some((c: unknown) => c[0] === 'chat.message.created'),
      ).toBe(true);
      expect(
        emitCalls.some((c: unknown) => c[0] === 'ai.moderation.request'),
      ).toBe(true);
    });

    it('should not fail if AI moderation emit fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(false);

      // Make publisher fail on the second call (ai moderation)
      publisher.emit
        .mockResolvedValueOnce(undefined) // ChatMessageCreated
        .mockRejectedValueOnce(new Error('Kafka down'));

      // Should not throw
      await expect(consumer.onSend(payload as unknown)).resolves.not.toThrow();

      await new Promise((r) => setTimeout(r, 50));
    });
  });

  // ─── onSend: Cache Invalidation ───────────────────────────────────────────

  describe('onSend — cache invalidation (non-blocking)', () => {
    it('should not fail if cache invalidation fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(false);
      cacheService.invalidateRecentMessages.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(consumer.onSend(payload as unknown)).resolves.not.toThrow();
    });
  });

  // ─── onEdit ────────────────────────────────────────────────────────────────

  describe('onEdit', () => {
    it('should update message body and emit ChatMessageUpdated', async () => {
      const payload = {
        message_id: 'msg-edit-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        new_body: 'Edited message text',
        created_at: Date.now() - 1000,
        edited_at: Date.now(),
        trace_id: 'test-trace',
      };

      await consumer.onEdit(payload);

      expect(repo.updateMessageBody).toHaveBeenCalledWith(
        payload.conversation_id,
        expect.any(Number),
        payload.message_id,
        payload.new_body,
        expect.any(Number),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.updated',
        expect.objectContaining({
          message_id: payload.message_id,
          body: payload.new_body,
        }),
      );
      expect(cacheService.invalidateRecentMessages).toHaveBeenCalledWith(
        payload.conversation_id,
      );
    });
  });

  // ─── onDelete ──────────────────────────────────────────────────────────────

  describe('onDelete', () => {
    it('should soft-delete message and emit ChatMessageDeleted', async () => {
      const payload = {
        message_id: 'msg-del-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        created_at: Date.now() - 1000,
        deleted_at: Date.now(),
        trace_id: 'test-trace',
      };

      await consumer.onDelete(payload);

      expect(repo.softDeleteMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        expect.any(Number),
        payload.message_id,
        expect.any(Number),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.deleted',
        expect.objectContaining({
          message_id: payload.message_id,
          sender_id: payload.sender_id,
        }),
      );
    });
  });

  // ─── onReactionAdd ─────────────────────────────────────────────────────────

  describe('onReactionAdd', () => {
    it('should add reaction and emit ChatReactionAdded', async () => {
      const payload = {
        message_id: 'msg-react-1',
        conversation_id: 'conv-1',
        user_id: 'user-1',
        reaction_type: 'like' as const,
        created_at: Date.now(),
        trace_id: 'test-trace',
      };

      await consumer.onReactionAdd(payload);

      expect(repo.addReaction).toHaveBeenCalledWith(
        expect.objectContaining({
          message_id: payload.message_id,
          user_id: payload.user_id,
          reaction_type: 'like',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.reaction.added',
        expect.objectContaining({
          message_id: payload.message_id,
          reaction_type: 'like',
        }),
      );
    });

    it('should add new reaction without prior remove (upsert semantics)', async () => {
      const payload = {
        message_id: 'msg-react-2',
        conversation_id: 'conv-1',
        user_id: 'user-1',
        reaction_type: 'love' as const,
        created_at: Date.now(),
        trace_id: 'test-trace',
      };

      await consumer.onReactionAdd(payload);

      // Implementation uses direct addReaction (atomic upsert) without separate remove step
      expect(repo.removeReaction).not.toHaveBeenCalled();
      expect(repo.addReaction).toHaveBeenCalledWith(
        expect.objectContaining({ reaction_type: 'love' }),
      );
    });
  });

  // ─── onReactionRemove ──────────────────────────────────────────────────────

  describe('onReactionRemove', () => {
    it('should remove reaction and emit ChatReactionRemoved', async () => {
      const payload = {
        message_id: 'msg-unreact-1',
        conversation_id: 'conv-1',
        user_id: 'user-1',
        trace_id: 'test-trace',
      };

      await consumer.onReactionRemove(payload);

      expect(repo.removeReaction).toHaveBeenCalledWith(
        payload.message_id,
        payload.user_id,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.reaction.removed',
        expect.objectContaining({
          message_id: payload.message_id,
          user_id: payload.user_id,
        }),
      );
    });
  });

  // ─── onSend: Error propagation ────────────────────────────────────────────

  describe('onSend — error propagation', () => {
    it('should throw when ScyllaDB insertMessage fails', async () => {
      const payload = createMockChatSendCommand();
      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.wasMessageSeen.mockResolvedValue(false);
      repo.insertMessage.mockRejectedValue(new Error('ScyllaDB write error'));

      await expect(consumer.onSend(payload as unknown)).rejects.toThrow(
        'ScyllaDB write error',
      );
    });
  });
});
