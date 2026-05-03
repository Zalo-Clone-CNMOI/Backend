/**
 * Unit tests for ModerationResultHandler — lock, deduplication, and retry
 *
 * Covers idempotency edge cases: already-deleted message re-emit, emit marker
 * deduplication, lock contention, lock loss before publish, and renewal failures.
 */
import { ModerationResultHandler } from '../moderation-result.handler';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import * as crypto from 'crypto';
import { CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import type { AppConfig } from '@libs/config';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';

describe('ModerationResultHandler — lock & dedup', () => {
  let handler: ModerationResultHandler;
  let shared: MessageConsumerSharedService;
  let repo: {
    trySoftDeleteMessage: jest.Mock;
    getMessage: jest.Mock;
    softDeleteMessage: jest.Mock;
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
  let appConfig: AppConfig;
  let notificationPublisher: { publish: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  const rebuildHandler = () => {
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

    handler = new ModerationResultHandler(
      appConfig,
      repo as unknown as MessageRepository,
      publisher as unknown as ChatPublisher,
      cacheService as unknown as CacheService,
      shared,
    );
  };

  beforeEach(() => {
    repo = {
      trySoftDeleteMessage: jest.fn(),
      getMessage: jest.fn(),
      softDeleteMessage: jest.fn(),
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

  describe('handle — already-deleted deduplication', () => {
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

      await handler.handle(payload);

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

      await handler.handle(payload);

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
        await expect(handler.handle(payload)).rejects.toThrow(
          'Kafka unavailable',
        );
        await handler.handle(payload);
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
  });

  describe('handle — lock contention', () => {
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

      await expect(handler.handle(payload)).rejects.toThrow(
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

      await expect(handler.handle(payload)).rejects.toThrow(
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

      await expect(handler.handle(payload)).rejects.toThrow(
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
  });

  describe('handle — message not found', () => {
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

      await expect(handler.handle(payload)).rejects.toThrow(
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
  });
});
