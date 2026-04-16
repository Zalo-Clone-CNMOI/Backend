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
import { createMockChatSendCommand, createMockChatForwardCommand } from '../../../../test/helpers';
import * as crypto from 'crypto';
import { CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import type { AppConfig } from '@libs/config';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { ConversationMembershipService } from '@libs/mvp-access';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';

describe('PersistMessageConsumer', () => {
  type InternalLogger = {
    debug: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  let consumer: PersistMessageConsumer;
  let repo: {
    tryBeginMessageProcessing: jest.Mock;
    getMessageProcessingState: jest.Mock;
    tryClaimPendingReplay: jest.Mock;
    restoreMessageProcessingToPending: jest.Mock;
    insertMessage: jest.Mock;
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
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  const rebuildConsumer = () => {
    consumer = new PersistMessageConsumer(
      appConfig,
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      membershipService as unknown as ConversationMembershipService,
      userRepo as unknown as Repository<User>,
      conversationMemberRepo as unknown as Repository<ConversationMember>,
    );

    const internalLogger = (consumer as unknown as { logger: InternalLogger })
      .logger;
    jest.spyOn(internalLogger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'error').mockImplementation(() => undefined);
  };

  beforeEach(() => {
    repo = {
      tryBeginMessageProcessing: jest.fn(),
      getMessageProcessingState: jest.fn(),
      tryClaimPendingReplay: jest.fn(),
      restoreMessageProcessingToPending: jest.fn(),
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

  // ─── onSend: Happy Path ────────────────────────────────────────────────────

  describe('onSend — happy path (TC-KAFKA-002)', () => {
    it('should persist message and emit ChatMessageCreated event', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockResolvedValue(undefined);
      repo.markMessageStored.mockResolvedValue(undefined);

      await consumer.onSend(payload);

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

  // ─── onSend: Idempotency ──────────────────────────────────────────────────

  describe('onSend — idempotency (TC-SVC-001, TC-KAFKA-003, TC-DB-004)', () => {
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

      await consumer.onSend(payload);

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

      await consumer.onSend(payload);

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

    it('should persist only once under concurrent duplicate onSend race', async () => {
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

      await Promise.all([consumer.onSend(payload), consumer.onSend(payload)]);

      expect(repo.insertMessage).toHaveBeenCalledTimes(1);
      expect(repo.markMessageStored).toHaveBeenCalledTimes(1);

      const createdEmits = (
        publisher.emit.mock.calls as Array<[string]>
      ).filter(([topic]) => topic === 'chat.message.created');
      expect(createdEmits).toHaveLength(1);
    });
  });

  describe('onSend — race/retry safety', () => {
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

      await expect(consumer.onSend(payload)).rejects.toThrow(
        'Kafka unavailable',
      );
      await consumer.onSend(payload);

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

      await expect(consumer.onSend(payload)).rejects.toThrow(
        'Scylla insert failed',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(
        payload.message_id,
      );
      expect(repo.markMessageStored).not.toHaveBeenCalled();
    });
  });

  // ─── onSend: Membership Re-Check ──────────────────────────────────────────

  describe('onSend — membership re-check (TC-SVC-002)', () => {
    it('should block unauthorized sender (not a member)', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(false);

      await consumer.onSend(payload);

      expect(repo.tryBeginMessageProcessing).not.toHaveBeenCalled();
      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  // ─── onSend: AI Moderation Trigger ─────────────────────────────────────────

  describe('onSend — AI moderation (non-blocking)', () => {
    it('should trigger AI moderation request after message persist', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.markMessageStored.mockResolvedValue(undefined);

      await consumer.onSend(payload);

      // Publisher should have been called at least twice:
      // 1. ChatMessageCreated
      // 2. AiModerationRequest (async)
      // We need to wait for the async fire-and-forget to complete
      // Flush all pending microtasks/macrotasks from fire-and-forget blocks
      // Drain the full microtask queue so fire-and-forget emissions settle.
      // setImmediate runs after all pending Promises, making this robust to
      // additional await-depths inside the consumer's async paths.
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
      await expect(consumer.onSend(payload)).resolves.not.toThrow();

      // Flush all pending microtasks/macrotasks from fire-and-forget blocks
      // Drain the full microtask queue so fire-and-forget emissions settle.
      // setImmediate runs after all pending Promises, making this robust to
      // additional await-depths inside the consumer's async paths.
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  // ─── onSend: Cache Invalidation ───────────────────────────────────────────

  describe('onSend — cache invalidation (non-blocking)', () => {
    it('should not fail if cache invalidation fails', async () => {
      const payload = createMockChatSendCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.markMessageStored.mockResolvedValue(undefined);
      cacheService.invalidateRecentMessages.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(consumer.onSend(payload)).resolves.not.toThrow();
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

  // ─── onSend: Error propagation ────────────────────────────────────────────

  describe('onSend — error propagation', () => {
    it('should throw when ScyllaDB insertMessage fails', async () => {
      const payload = createMockChatSendCommand();
      membershipService.canUserAccessConversation.mockResolvedValue(true);
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertMessage.mockRejectedValue(new Error('ScyllaDB write error'));
      repo.clearMessageProcessing.mockResolvedValue(undefined);

      await expect(consumer.onSend(payload)).rejects.toThrow(
        'ScyllaDB write error',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(
        payload.message_id,
      );
    });
  });

  describe('onModerationResult', () => {
    const createFlaggedModerationPayload = () => ({
      message_id: 'msg-moderation-ttl',
      conversation_id: 'conv-ttl',
      sender_id: 'user-ttl',
      created_at: Date.now() - 1000,
      is_flagged: true,
      labels: ['spam' as const],
      confidence: 1,
      provider: 'openai' as const,
      ensemble: false,
      decision_source: 'model' as const,
      processed_at: Date.now(),
      tokens_used: 0,
      trace_id: 'mod-trace-ttl',
    });

    it('should enforce soft-delete and emit ChatMessageDeleted when flagged', async () => {
      const payload = {
        message_id: 'msg-moderation-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-1',
      };

      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
        expect.any(Number),
      );
      expect(repo.getMessage).not.toHaveBeenCalled();
      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        120,
      );
      const [, lockToken] = cacheService.setIfAbsent.mock.calls[0] as [
        string,
        string,
        number,
      ];
      expect(lockToken).not.toBe(payload.trace_id);
      expect(cacheService.set).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}`,
        ),
        true,
        86400,
      );
      expect(cacheService.delIfValueMatches).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        lockToken,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.deleted',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
        }),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'deleted',
          action: 'soft_delete',
        }),
      );
      expect(cacheService.invalidateRecentMessages).toHaveBeenCalledWith(
        payload.conversation_id,
      );
    });

    it('should skip poison moderation payload when created_at is missing', async () => {
      const payload = {
        message_id: 'msg-mod-poison',
        conversation_id: 'conv-mod',
        sender_id: 'user-mod',
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-poison',
      } as unknown as Parameters<typeof consumer.onModerationResult>[0];

      await expect(consumer.onModerationResult(payload)).resolves.not.toThrow();

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(repo.getMessage).not.toHaveBeenCalled();
      expect(cacheService.setIfAbsent).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });

    it('should not soft-delete when moderation decision source is fallback', async () => {
      const payload = {
        message_id: 'msg-mod-fallback-skip',
        conversation_id: 'conv-mod-fallback-skip',
        sender_id: 'user-mod-fallback-skip',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'fallback_provider_failure' as const,
        failure_reason: 'provider timeout',
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-fallback-skip',
      };

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(cacheService.setIfAbsent).not.toHaveBeenCalled();

      const emitCalls = publisher.emit.mock.calls as Array<[string, unknown]>;
      const deletedCalls = emitCalls.filter(
        ([topic]) => topic === 'chat.message.deleted',
      );
      expect(deletedCalls).toHaveLength(0);

      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'not_flagged',
          action: 'none',
          reason: 'fallback_decision_source',
        }),
      );
    });

    it('should skip soft-delete when confidence is below configured threshold', async () => {
      appConfig.chatModerationWarnOnly = false;
      appConfig.chatModerationEnforceMinConfidence = 0.95;
      appConfig.chatModerationHighRiskLabels = ['spam', 'toxic'];
      rebuildConsumer();

      const payload = {
        message_id: 'msg-mod-low-confidence',
        conversation_id: 'conv-mod-low-confidence',
        sender_id: 'user-mod-low-confidence',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 0.7,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-low-confidence',
      };

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          action: 'none',
          outcome: 'not_flagged',
          reason: 'below_confidence_threshold',
        }),
      );
    });

    it('should skip soft-delete when flagged labels are not high-risk', async () => {
      appConfig.chatModerationWarnOnly = false;
      appConfig.chatModerationEnforceMinConfidence = 0.7;
      appConfig.chatModerationHighRiskLabels = ['spam', 'violence'];
      rebuildConsumer();

      const payload = {
        message_id: 'msg-mod-low-risk-label',
        conversation_id: 'conv-mod-low-risk-label',
        sender_id: 'user-mod-low-risk-label',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['clean' as const],
        confidence: 0.99,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-low-risk-label',
      };

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          action: 'none',
          outcome: 'not_flagged',
          reason: 'label_not_high_risk',
        }),
      );
    });

    it('should skip soft-delete in warn-only mode for staging/dev QA', async () => {
      appConfig.chatModerationWarnOnly = true;
      appConfig.chatModerationEnforceMinConfidence = 0.1;
      appConfig.chatModerationHighRiskLabels = ['spam', 'toxic'];
      rebuildConsumer();

      const payload = {
        message_id: 'msg-mod-warn-only',
        conversation_id: 'conv-mod-warn-only',
        sender_id: 'user-mod-warn-only',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: 'mod-trace-warn-only',
      };

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          action: 'none',
          outcome: 'not_flagged',
          reason: 'warn_only_mode',
        }),
      );
    });

    it('should use custom configured lock TTL for moderation emit lock', async () => {
      appConfig.chatModerationDeleteLockTtlSeconds = 300;
      rebuildConsumer();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await consumer.onModerationResult(payload);

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        300,
      );
    });

    it('should clamp too-small configured lock TTL to minimum', async () => {
      appConfig.chatModerationDeleteLockTtlSeconds = 1;
      rebuildConsumer();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await consumer.onModerationResult(payload);

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        30,
      );
    });

    it('should fallback to default lock TTL when configured value is invalid', async () => {
      appConfig.chatModerationDeleteLockTtlSeconds = Number.POSITIVE_INFINITY;
      rebuildConsumer();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await consumer.onModerationResult(payload);

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        120,
      );
    });

    it('should skip moderation enforcement when message is already deleted', async () => {
      const payload = {
        message_id: 'msg-moderation-3',
        conversation_id: 'conv-3',
        sender_id: 'user-3',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['toxic' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(false);
      cacheService.get.mockResolvedValue(true);

      repo.getMessage.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: '',
        created_at: payload.created_at,
        deleted_at: Date.now() - 10,
      });

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
        expect.any(Number),
      );
      expect(repo.getMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
      );
      expect(cacheService.get).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}`,
        ),
      );
      expect(cacheService.setIfAbsent).not.toHaveBeenCalled();
      expect(repo.softDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'deduplicated',
          reason: 'delete_event_already_emitted',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).not.toHaveBeenCalled();
    });

    it('should emit deduplicated outcome when delete marker already exists after lock acquisition', async () => {
      const payload = {
        message_id: 'msg-moderation-dedupe-after-lock-1',
        conversation_id: 'conv-dedupe-after-lock-1',
        sender_id: 'user-dedupe-after-lock-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(true);
      cacheService.get.mockResolvedValue(true);

      await consumer.onModerationResult(payload);

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        120,
      );
      expect(cacheService.get).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}`,
        ),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'deduplicated',
          reason: 'delete_event_already_emitted_after_lock_acquired',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.set).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
      );
    });

    it('should re-emit delete event on retry when message already deleted but emit marker is missing', async () => {
      const payload = {
        message_id: 'msg-moderation-retry-1',
        conversation_id: 'conv-retry-1',
        sender_id: 'user-retry-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      publisher.emit
        .mockRejectedValueOnce(new Error('Kafka unavailable'))
        .mockResolvedValueOnce(undefined);
      repo.getMessage.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: '',
        created_at: payload.created_at,
        deleted_at: Date.now() - 10,
      });
      cacheService.get.mockResolvedValue(null);

      const randomUuidSpy = jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');

      try {
        await expect(consumer.onModerationResult(payload)).rejects.toThrow(
          'Kafka unavailable',
        );
        await consumer.onModerationResult(payload);
      } finally {
        randomUuidSpy.mockRestore();
      }

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        '11111111-1111-4111-8111-111111111111',
        120,
      );
      expect(cacheService.setIfAbsent).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        '22222222-2222-4222-8222-222222222222',
        120,
      );
      // First invocation: delete event emit threw, then enforcement outcome emitted
      expect(publisher.emit).toHaveBeenCalledWith(
        'chat.message.deleted',
        expect.objectContaining({ message_id: payload.message_id }),
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          outcome: 'failed',
          reason: 'chat_message_deleted_emit_failed',
          action: 'soft_delete',
        }),
      );
      // Second invocation: delete event succeeded, already_deleted outcome emitted
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          outcome: 'already_deleted',
          action: 'soft_delete',
        }),
      );
      // 4 total: 2× chat.message.deleted + 2× ai.moderation.enforcement
      expect(publisher.emit).toHaveBeenCalledTimes(4);
      expect(cacheService.set).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}`,
        ),
        true,
        86400,
      );
      expect(cacheService.delIfValueMatches).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        '11111111-1111-4111-8111-111111111111',
      );
      expect(cacheService.delIfValueMatches).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        '22222222-2222-4222-8222-222222222222',
      );
    });

    it('should throw when retry emit lock is busy for deleted message', async () => {
      const payload = {
        message_id: 'msg-moderation-lock-1',
        conversation_id: 'conv-lock-1',
        sender_id: 'user-lock-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(false);
      repo.getMessage.mockResolvedValue({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: '',
        created_at: payload.created_at,
        deleted_at: Date.now() - 10,
      });
      cacheService.get.mockResolvedValue(null);
      cacheService.setIfAbsent.mockResolvedValue(false);

      await expect(consumer.onModerationResult(payload)).rejects.toThrow(
        'Moderation delete event emit lock busy',
      );

      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'failed',
          reason: 'delete_emit_lock_busy',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.set).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).not.toHaveBeenCalled();
    });

    it('should throw when lock is lost before delete event publish', async () => {
      const payload = {
        message_id: 'msg-moderation-lock-lost-1',
        conversation_id: 'conv-lock-lost-1',
        sender_id: 'user-lock-lost-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(true);
      cacheService.expireIfValueMatches.mockResolvedValue(
        CACHE_LOCK_RENEW_STATUS.Mismatch,
      );

      await expect(consumer.onModerationResult(payload)).rejects.toThrow(
        'Moderation delete event emit lock lost before publish',
      );

      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'failed',
          reason: 'delete_emit_lock_lost_before_publish',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.set).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
      );
    });

    it('should throw renewal failed when pre-emit lock renewal returns infra error', async () => {
      const payload = {
        message_id: 'msg-moderation-lock-error-1',
        conversation_id: 'conv-lock-error-1',
        sender_id: 'user-lock-error-1',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(true);
      cacheService.expireIfValueMatches.mockResolvedValue(
        CACHE_LOCK_RENEW_STATUS.Error,
      );

      await expect(consumer.onModerationResult(payload)).rejects.toThrow(
        'Moderation delete event emit lock renewal failed',
      );

      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'failed',
          reason: 'delete_emit_lock_renewal_failed',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.set).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
      );
    });

    it('should skip moderation enforcement when message row is missing', async () => {
      const payload = {
        message_id: 'msg-moderation-4',
        conversation_id: 'conv-4',
        sender_id: 'user-4',
        created_at: Date.now() - 1000,
        is_flagged: true,
        labels: ['spam' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      repo.trySoftDeleteMessage.mockResolvedValue(false);
      repo.getMessage.mockResolvedValue(null);

      await expect(consumer.onModerationResult(payload)).rejects.toThrow(
        'Moderation target message not found',
      );

      expect(repo.trySoftDeleteMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
        expect.any(Number),
      );
      expect(repo.getMessage).toHaveBeenCalledWith(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
      );
      expect(repo.softDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).toHaveBeenCalledWith(
        'ai.moderation.enforcement',
        expect.objectContaining({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          outcome: 'failed',
          reason: 'message_not_found',
        }),
      );
      expect(publisher.emit).toHaveBeenCalledTimes(1);
      expect(cacheService.setIfAbsent).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).not.toHaveBeenCalled();
    });

    it('should skip moderation enforcement when message is not flagged', async () => {
      const payload = {
        message_id: 'msg-moderation-2',
        conversation_id: 'conv-2',
        sender_id: 'user-2',
        created_at: Date.now() - 1000,
        is_flagged: false,
        labels: ['clean' as const],
        confidence: 1,
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'model' as const,
        processed_at: Date.now(),
        tokens_used: 0,
      };

      await consumer.onModerationResult(payload);

      expect(repo.trySoftDeleteMessage).not.toHaveBeenCalled();
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
      expect(cacheService.setIfAbsent).not.toHaveBeenCalled();
      expect(repo.softDeleteMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
      expect(cacheService.delIfValueMatches).not.toHaveBeenCalled();
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

      await consumer.onForward(payload as any);

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

      await consumer.onForward(payload as any);

      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  describe('onForward — access denied', () => {
    it('should skip processing when sender has no access to conversation', async () => {
      const payload = createMockChatForwardCommand();

      membershipService.canUserAccessConversation.mockResolvedValue(false);

      await consumer.onForward(payload as any);

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

      await expect(consumer.onForward(payload as any)).rejects.toThrow(
        'ScyllaDB write failed',
      );

      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });
});
