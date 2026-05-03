/**
 * Unit tests for SendMessageHandler (chat-service)
 *
 * Covers: TC-SVC-001, TC-SVC-002, TC-KAFKA-002, TC-KAFKA-003, TC-DB-004
 * - Message deduplication via idempotency table
 * - Membership re-check before persist
 * - Message persist → event emit flow
 * - AI moderation trigger (non-blocking)
 * - Cache invalidation (non-blocking)
 */
import { SendMessageHandler } from '../send-message.handler';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import { createMockChatSendCommand } from '../../../../../test/helpers';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { ConversationMembershipService } from '@libs/mvp-access';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';

describe('SendMessageHandler', () => {
  let handler: SendMessageHandler;
  let shared: MessageConsumerSharedService;
  let repo: {
    tryBeginMessageProcessing: jest.Mock;
    getMessageProcessingState: jest.Mock;
    tryClaimPendingReplay: jest.Mock;
    restoreMessageProcessingToPending: jest.Mock;
    insertMessage: jest.Mock;
    insertMentions: jest.Mock;
    markMessageStored: jest.Mock;
    clearMessageProcessing: jest.Mock;
    getMessage: jest.Mock;
  };
  let publisher: { emit: jest.Mock };
  let cacheService: { invalidateRecentMessages: jest.Mock };
  let membershipService: { canUserAccessConversation: jest.Mock };
  let notificationPublisher: { publish: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  const rebuildHandler = () => {
    shared = new MessageConsumerSharedService(
      notificationPublisher as unknown as NotificationOutboxPublisher,
      publisher as unknown as ChatPublisher,
      userRepo as unknown as Repository<User>,
      conversationMemberRepo as unknown as Repository<ConversationMember>,
    );
    jest.spyOn(shared.logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'error').mockImplementation(() => undefined);

    handler = new SendMessageHandler(
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      membershipService as unknown as ConversationMembershipService,
      shared,
    );
  };

  beforeEach(() => {
    repo = {
      tryBeginMessageProcessing: jest.fn(),
      getMessageProcessingState: jest.fn(),
      tryClaimPendingReplay: jest.fn(),
      restoreMessageProcessingToPending: jest.fn(),
      insertMessage: jest.fn(),
      insertMentions: jest.fn().mockResolvedValue(undefined),
      markMessageStored: jest.fn(),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
      getMessage: jest.fn(),
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

    notificationPublisher = {
      publish: jest.fn().mockResolvedValue('ok'),
    };

    userRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    conversationMemberRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    rebuildHandler();
  });

  // ─── Happy Path ────────────────────────────────────────────────────────────

  describe('handle — happy path (TC-KAFKA-002)', () => {
    it('should persist message and emit ChatMessageCreated event', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageStored.mockResolvedValue(undefined);

      await handler.handle(payload);

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
          created_at: payload.sent_at,
        }),
      );
      expect(repo.markMessageStored).toHaveBeenCalledWith(payload.message_id);
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          created_at: payload.sent_at,
        }),
      );
    });
  });

  // ─── Idempotency ───────────────────────────────────────────────────────────

  describe('handle — idempotency (TC-SVC-001, TC-KAFKA-003, TC-DB-004)', () => {
    it('should skip duplicate message when processing lock cannot be acquired', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(false);
      repo.getMessageProcessingState.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.sent_at,
        status: 'stored',
      });

      await handler.handle(payload);

      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(repo.markMessageStored).not.toHaveBeenCalled();
      expect(repo.clearMessageProcessing).not.toHaveBeenCalled();
      expect(repo.tryClaimPendingReplay).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });

    it('should replay pending message once and mark as stored', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(false);
      repo.getMessageProcessingState.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.sent_at,
        status: 'pending',
      });
      repo.tryClaimPendingReplay.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.sent_at,
        attachments: payload.attachments,
        reply_to_message_id: payload.reply_to_message_id,
      });

      await handler.handle(payload);

      expect(repo.tryClaimPendingReplay).toHaveBeenCalledWith(
        payload.message_id,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({
          message_id: payload.message_id,
          created_at: payload.sent_at,
        }),
      );
      expect(repo.markMessageStored).toHaveBeenCalledWith(payload.message_id);
      expect(repo.restoreMessageProcessingToPending).not.toHaveBeenCalled();
    });

    it('should persist only once under concurrent duplicate handle race', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      repo.getMessageProcessingState.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.sent_at,
        status: 'stored',
      });
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageStored.mockResolvedValue(undefined);

      await Promise.all([handler.handle(payload), handler.handle(payload)]);

      expect(repo.insertMessage).toHaveBeenCalledTimes(1);
      expect(repo.markMessageStored).toHaveBeenCalledTimes(1);

      const createdEmits = (
        publisher.emit.mock.calls as Array<[string]>
      ).filter(([topic]) => topic === 'chat.message.created');
      expect(createdEmits).toHaveLength(1);
    });
  });

  // ─── Race / Retry Safety ──────────────────────────────────────────────────

  describe('handle — race/retry safety', () => {
    it('should keep pending marker and replay on retry when publisher fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      repo.getMessageProcessingState.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.sent_at,
        status: 'pending',
      });
      repo.tryClaimPendingReplay.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.sent_at,
        attachments: payload.attachments,
        reply_to_message_id: payload.reply_to_message_id,
      });
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageStored.mockResolvedValue(undefined);
      repo.clearMessageProcessing.mockResolvedValue(undefined);
      publisher.emit
        .mockRejectedValueOnce(new Error('Kafka unavailable'))
        .mockResolvedValue(undefined);

      await expect(handler.handle(payload)).rejects.toThrow(
        'Kafka unavailable',
      );
      await handler.handle(payload);

      expect(repo.clearMessageProcessing).not.toHaveBeenCalled();
      expect(repo.tryBeginMessageProcessing).toHaveBeenCalledTimes(2);
      expect(repo.markMessageStored).toHaveBeenCalledTimes(1);
      expect(repo.tryClaimPendingReplay).toHaveBeenCalledWith(
        payload.message_id,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({ message_id: payload.message_id }),
      );
    });

    it('should clear processing lock when message insert fails after lock acquisition', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockRejectedValue(new Error('Scylla insert failed'));
      repo.clearMessageProcessing.mockResolvedValue(undefined);

      await expect(handler.handle(payload)).rejects.toThrow(
        'Scylla insert failed',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(
        payload.message_id,
      );
      expect(repo.markMessageStored).not.toHaveBeenCalled();
    });
  });

  // ─── Membership Re-Check ──────────────────────────────────────────────────

  describe('handle — membership re-check (TC-SVC-002)', () => {
    it('should block unauthorized sender (not a member)', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(false);

      await handler.handle(payload);

      expect(repo.tryBeginMessageProcessing).not.toHaveBeenCalled();
      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  // ─── AI Moderation Trigger ─────────────────────────────────────────────────

  describe('handle — AI moderation (non-blocking)', () => {
    it('should trigger AI moderation request after message persist', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.markMessageStored.mockResolvedValue(undefined);

      await handler.handle(payload);

      // Drain the full microtask queue so fire-and-forget emissions settle.
      // setImmediate runs after all pending Promises, making this robust to
      // additional await-depths inside the handler's async paths.
      await new Promise((resolve) => setImmediate(resolve));

      const emitCalls = publisher.emit.mock.calls as Array<[string, unknown]>;
      expect(emitCalls.some((c) => c[0] === 'chat.message.created')).toBe(true);
      expect(emitCalls.some((c) => c[0] === 'ai.moderation.request')).toBe(
        true,
      );
      expect(emitCalls).toEqual(
        expect.arrayContaining([
          [
            'ai.moderation.request',
            expect.objectContaining({
              message_id: payload.message_id,
              created_at: payload.sent_at,
            }),
          ],
        ]),
      );
    });

    it('should not fail if AI moderation emit fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.markMessageStored.mockResolvedValue(undefined);

      // Make publisher fail on the second call (ai moderation)
      publisher.emit
        .mockResolvedValueOnce(undefined) // ChatMessageCreated
        .mockRejectedValueOnce(new Error('Kafka down'));

      // Should not throw
      await expect(handler.handle(payload)).resolves.not.toThrow();

      // Drain the full microtask queue so fire-and-forget emissions settle.
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  // ─── Cache Invalidation ───────────────────────────────────────────────────

  describe('handle — cache invalidation (non-blocking)', () => {
    it('should not fail if cache invalidation fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.markMessageStored.mockResolvedValue(undefined);
      cacheService.invalidateRecentMessages.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(handler.handle(payload)).resolves.not.toThrow();
    });
  });

  // ─── Error Propagation ────────────────────────────────────────────────────

  describe('handle — error propagation', () => {
    it('should throw when ScyllaDB insertMessage fails', async () => {
      const payload = createMockChatSendCommand();
      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockRejectedValue(new Error('ScyllaDB write error'));
      repo.clearMessageProcessing.mockResolvedValue(undefined);

      await expect(handler.handle(payload)).rejects.toThrow(
        'ScyllaDB write error',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(
        payload.message_id,
      );
    });
  });

  // ─── Mentions persistence + event propagation (Task 11) ───────────────────

  describe('SendMessageHandler — mentions', () => {
    it('should call insertMentions and include mentions in ChatMessageCreated event', async () => {
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.insertMentions = jest.fn().mockResolvedValue(undefined);
      publisher.emit.mockResolvedValue(undefined);

      const payload = {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-sender',
        body: 'Hi @user-1',
        sent_at: 1700000000000,
        mentions: [
          { user_id: 'user-1', mention_type: 'user', offset: 3, length: 6 },
        ],
      };

      await handler.handle(payload as any);

      expect(repo.insertMentions).toHaveBeenCalledWith({
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-sender',
        created_at: 1700000000000,
        mentions: payload.mentions,
      });

      const emittedEvent = publisher.emit.mock.calls.find(
        ([topic]: [string]) => topic === 'chat.message.created',
      )?.[1];
      expect(emittedEvent.mentions).toEqual(payload.mentions);
    });

    it('should NOT call insertMentions when mentions array is empty or undefined', async () => {
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.insertMentions = jest.fn().mockResolvedValue(undefined);
      publisher.emit.mockResolvedValue(undefined);

      await handler.handle({
        message_id: 'msg-2',
        conversation_id: 'conv-1',
        sender_id: 'user-sender',
        body: 'no mentions',
        sent_at: 1700000000000,
      } as any);

      expect(repo.insertMentions).not.toHaveBeenCalled();
    });
  });
});
