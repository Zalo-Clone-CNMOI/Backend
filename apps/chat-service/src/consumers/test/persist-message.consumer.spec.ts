/**
 * Unit tests for PersistMessageConsumer (chat-service)
 *
 * Covers the inline event handlers that remain in the controller:
 * onEdit, onDelete, onReactionAdd, onReactionRemove, onForward.
 *
 * See send-message.handler.spec.ts for onSend tests.
 * See moderation-result.handler.spec.ts / moderation-result.handler-lock.spec.ts
 * for onModerationResult tests.
 */
import { PersistMessageConsumer } from '../persist-message.consumer';
import { SendMessageHandler } from '../send-message.handler';
import { ModerationResultHandler } from '../moderation-result.handler';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import { createMockChatForwardCommand } from '../../../../../test/helpers';
import { CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import type { AppConfig } from '@libs/config';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { ConversationMembershipService } from '@libs/mvp-access';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';
import { SystemEventType, SystemMessageMetadata } from '@libs/contracts';
import { MessageType } from '@app/constant';

describe('PersistMessageConsumer', () => {
  let consumer: PersistMessageConsumer;
  let shared: MessageConsumerSharedService;
  let repo: {
    tryBeginMessageProcessing: jest.Mock;
    getMessageProcessingState: jest.Mock;
    insertMessage: jest.Mock;
    insertSystemMessage: jest.Mock;
    markMessageStored: jest.Mock;
    clearMessageProcessing: jest.Mock;
    trySoftDeleteMessage: jest.Mock;
    updateMessageBody: jest.Mock;
    softDeleteMessage: jest.Mock;
    getMessage: jest.Mock;
    getReactionsByUser: jest.Mock;
    addReaction: jest.Mock;
    removeReaction: jest.Mock;
  };
  let publisher: { emit: jest.Mock };
  let cacheService: {
    get: jest.Mock;
    set: jest.Mock;
    setIfAbsent: jest.Mock;
    expireIfValueMatches: jest.Mock;
    delIfValueMatches: jest.Mock;
    invalidateRecentMessages: jest.Mock;
  };
  let membershipService: { canUserAccessConversation: jest.Mock };
  let appConfig: AppConfig;
  let notificationPublisher: { publish: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  const rebuildConsumer = () => {
    shared = new MessageConsumerSharedService(
      notificationPublisher as unknown as NotificationOutboxPublisher,
      publisher as unknown as ChatPublisher,
      userRepo as unknown as Repository<User>,
      conversationMemberRepo as unknown as Repository<ConversationMember>,
      repo as unknown as MessageRepository,
    );
    jest.spyOn(shared.logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(shared.logger, 'error').mockImplementation(() => undefined);

    // Pre-send moderation gate not exercised by persist-message tests —
    // stub it as a passthrough so the handler constructor signature
    // matches and the gate never blocks. Pre-send-specific behaviors
    // live in send-message.handler.spec.ts.
    const stubPreSendModerationService = {
      checkOrAllow: jest.fn().mockResolvedValue(null),
    };

    const sendHandler = new SendMessageHandler(
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      membershipService as unknown as ConversationMembershipService,
      shared,
      stubPreSendModerationService as never,
      appConfig,
    );

    const moderationHandler = new ModerationResultHandler(
      appConfig,
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      shared,
    );

    consumer = new PersistMessageConsumer(
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      membershipService as unknown as ConversationMembershipService,
      sendHandler,
      moderationHandler,
      shared,
    );
  };

  beforeEach(() => {
    repo = {
      tryBeginMessageProcessing: jest.fn(),
      getMessageProcessingState: jest.fn(),
      insertMessage: jest.fn(),
      markMessageStored: jest.fn(),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
      trySoftDeleteMessage: jest.fn(),
      updateMessageBody: jest.fn(),
      softDeleteMessage: jest.fn(),
      getMessage: jest.fn(),
      getReactionsByUser: jest.fn(),
      addReaction: jest.fn(),
      removeReaction: jest.fn(),
      insertSystemMessage: jest.fn(),
    };

    publisher = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      expireIfValueMatches: jest
        .fn()
        .mockResolvedValue(CACHE_LOCK_RENEW_STATUS.Renewed),
      delIfValueMatches: jest.fn().mockResolvedValue(true),
      invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    membershipService = {
      canUserAccessConversation: jest.fn(),
    };

    appConfig = {
      nodeEnv: 'test',
      serviceName: 'chat-service',
      kafkaBrokers: ['localhost:9092'],
      kafkaClientId: 'test',
      scyllaContactPoints: ['127.0.0.1'],
      scyllaLocalDatacenter: 'datacenter1',
      scyllaKeyspace: 'chat',
      allowedOrigins: ['http://localhost:3000'],
      chatModerationDeleteLockTtlSeconds: 120,
      zaiBotUserId: '00000000-0000-0000-0000-0000000000a1',
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

    rebuildConsumer();
  });

  // ─── onSystemMessage ───────────────────────────────────────────────────────

  describe('onSystemMessage', () => {
    it('should persist system message and invalidate cache', async () => {
      const payload = {
        message_id: 'sys-1',
        conversation_id: 'conv-1',
        message_type: 'system' as MessageType.SYSTEM,
        system_event_type: 'member_added' as SystemEventType,
        metadata: { added_by: '1' } as SystemMessageMetadata,
        body: 'User added',
        created_at: Date.now(),
        trace_id: 'test-trace',
      };

      repo.tryBeginMessageProcessing.mockResolvedValue(true);

      await consumer.onSystemMessage(payload);

      expect(repo.insertSystemMessage).toHaveBeenCalledWith({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        message_type: payload.message_type,
        system_event_type: payload.system_event_type,
        metadata: payload.metadata,
        body: payload.body,
        created_at: payload.created_at,
      });
      expect(repo.markMessageStored).toHaveBeenCalledWith(payload.message_id);
      expect(cacheService.invalidateRecentMessages).toHaveBeenCalledWith(
        payload.conversation_id,
      );
    });

    it('should skip processing if already processed (idempotent)', async () => {
      const payload = {
        message_id: 'sys-2',
        conversation_id: 'conv-1',
        metadata: { removed_by: 'user-1' } as SystemMessageMetadata,
        message_type: 'system' as MessageType.SYSTEM,
        system_event_type: 'member_removed' as SystemEventType,
        body: 'User removed',
        created_at: Date.now(),
        trace_id: 'test-trace',
      };

      repo.tryBeginMessageProcessing.mockResolvedValue(false);

      await consumer.onSystemMessage(payload);

      expect(repo.insertSystemMessage).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });

    it('should clear message processing lock and rethrow if insert fails', async () => {
      const payload = {
        message_id: 'sys-3',
        conversation_id: 'conv-1',
        message_type: 'system' as MessageType.SYSTEM,
        system_event_type: 'member_left' as SystemEventType,
        metadata: {} as SystemMessageMetadata,
        body: 'User left',
        created_at: Date.now(),
        trace_id: 'test-trace',
      };

      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertSystemMessage.mockRejectedValue(
        new Error('ScyllaDB write failed'),
      );

      await expect(consumer.onSystemMessage(payload)).rejects.toThrow(
        'ScyllaDB write failed',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(
        payload.message_id,
      );
      expect(repo.markMessageStored).not.toHaveBeenCalled();
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

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({ sender_id: payload.sender_id });

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

    it('should block edit when sender is not the message owner', async () => {
      const payload = {
        message_id: 'msg-edit-unauthorized',
        conversation_id: 'conv-1',
        sender_id: 'user-requester',
        new_body: 'Edited body',
        created_at: Date.now() - 1000,
        edited_at: Date.now(),
        trace_id: 'test-trace',
      };

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({ sender_id: 'user-owner' });

      await consumer.onEdit(payload);

      expect(repo.updateMessageBody).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalledWith(
        'chat.message.updated',
        expect.anything(),
      );
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });

    it('should skip poison edit payload when created_at is missing', async () => {
      const payload = {
        message_id: 'msg-edit-poison',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        new_body: 'Edited body',
        edited_at: Date.now(),
        trace_id: 'test-trace',
      } as unknown as Parameters<typeof consumer.onEdit>[0];

      await expect(consumer.onEdit(payload)).resolves.not.toThrow();

      expect(
        membershipService.canUserAccessConversation,
      ).not.toHaveBeenCalled();
      expect(repo.getMessage).not.toHaveBeenCalled();
      expect(repo.updateMessageBody).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalledWith(
        'chat.message.updated',
        expect.anything(),
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

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({ sender_id: payload.sender_id });

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

    it('should block delete when sender is not the message owner', async () => {
      const payload = {
        message_id: 'msg-del-unauthorized',
        conversation_id: 'conv-1',
        sender_id: 'user-requester',
        created_at: Date.now() - 1000,
        deleted_at: Date.now(),
        trace_id: 'test-trace',
      };

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.getMessage.mockResolvedValue({ sender_id: 'user-owner' });

      await consumer.onDelete(payload);

      expect(repo.softDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalledWith(
        'chat.message.deleted',
        expect.anything(),
      );
      // Cache must not be touched when ownership check blocks the delete
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });

    it('should skip poison delete payload when created_at is missing', async () => {
      const payload = {
        message_id: 'msg-del-poison',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        deleted_at: Date.now(),
        trace_id: 'test-trace',
      } as unknown as Parameters<typeof consumer.onDelete>[0];

      await expect(consumer.onDelete(payload)).resolves.not.toThrow();

      expect(
        membershipService.canUserAccessConversation,
      ).not.toHaveBeenCalled();
      expect(repo.getMessage).not.toHaveBeenCalled();
      expect(repo.softDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalledWith(
        'chat.message.deleted',
        expect.anything(),
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

  // ─── onForward ─────────────────────────────────────────────────────────────

  describe('onForward — happy path', () => {
    it('should persist forwarded message and emit ChatMessageCreated with forwarded_from', async () => {
      const payload = createMockChatForwardCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageStored.mockResolvedValue(undefined);

      await consumer.onForward(payload);

      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          forwarded_from: payload.forwarded_from,
        }),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({
          message_id: payload.message_id,
          forwarded_from: payload.forwarded_from,
        }),
      );
      expect(repo.markMessageStored).toHaveBeenCalledWith(payload.message_id);
    });
  });

  describe('onForward — idempotency', () => {
    it('should skip processing when tryBeginMessageProcessing returns false', async () => {
      const payload = createMockChatForwardCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(false);
      repo.getMessageProcessingState.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.sent_at,
        status: 'stored',
      });

      await consumer.onForward(payload);

      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  describe('onForward — access denied', () => {
    it('should skip processing when sender has no access to conversation', async () => {
      const payload = createMockChatForwardCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(false);

      await consumer.onForward(payload);

      expect(repo.tryBeginMessageProcessing).not.toHaveBeenCalled();
      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  describe('onForward — error propagation', () => {
    it('should rethrow error when insertMessage fails', async () => {
      const payload = createMockChatForwardCommand();
      const insertError = new Error('ScyllaDB write failed');

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockRejectedValue(insertError);

      await expect(consumer.onForward(payload)).rejects.toThrow(
        'ScyllaDB write failed',
      );

      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });
});
