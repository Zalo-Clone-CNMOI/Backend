/**
 * Unit tests for ModerationResultHandler — policy and enforcement decisions
 *
 * Covers basic enforcement: happy-path delete, policy skip reasons (warn-only,
 * confidence threshold, label risk), fallback decision source, poison payload,
 * and lock TTL configuration.
 */
import { ModerationResultHandler } from '../moderation-result.handler';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import { CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import type { AppConfig } from '@libs/config';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';

describe('ModerationResultHandler', () => {
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

    rebuildHandler();
  });

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

  describe('handle', () => {
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

      await handler.handle(payload);

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
      } as unknown as Parameters<typeof handler.handle>[0];

      await expect(handler.handle(payload)).resolves.not.toThrow();

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

      await handler.handle(payload);

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
      rebuildHandler();

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

      await handler.handle(payload);

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
      rebuildHandler();

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

      await handler.handle(payload);

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
      rebuildHandler();

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

      await handler.handle(payload);

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
      rebuildHandler();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await handler.handle(payload);

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
      rebuildHandler();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await handler.handle(payload);

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
      rebuildHandler();

      const payload = createFlaggedModerationPayload();
      repo.trySoftDeleteMessage.mockResolvedValue(true);

      await handler.handle(payload);

      expect(cacheService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `${payload.conversation_id}:${payload.message_id}:lock`,
        ),
        expect.any(String),
        120,
      );
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

      await handler.handle(payload);

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
});
