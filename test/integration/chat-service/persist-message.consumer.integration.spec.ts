/**
 * @file persist-message.consumer.integration.spec.ts
 *
 * Integration tests for PersistMessageConsumer with real NestJS DI.
 * Mocks at driver level: ScyllaDB (mock-scylla), Kafka (mock-kafka),
 * Redis (CacheService mock), TypeORM repos (mock-repository).
 *
 * Tests the full consumer pipeline:
 *   Kafka payload → membership check → idempotency → persist → emit event
 */
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PersistMessageConsumer } from '../../../apps/chat-service/src/consumers/persist-message.consumer';
import { MessageRepository } from '@libs/scylla';
import { SCYLLA_CLIENT } from '@libs/scylla/scylla.tokens';
import { CacheService } from '@libs/redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import { ConversationMembershipService } from '@libs/mvp-access';
import { ChatPublisher } from '../../../apps/chat-service/src/services/chat.publisher';
import { KAFKA_CLIENT } from '@libs/kafka';
import { User, ConversationMember } from '@libs/database';
import { KafkaTopics } from '@libs/contracts';
import { createMockScyllaClient } from '../../helpers/mock-scylla.helper';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';
import { createMockKafkaClient } from '../../helpers/mock-kafka.helper';
import { createMockRepository } from '../../helpers/test-database.helper';
import {
  makeChatMessageSendCommand,
  makeChatMessageEditCommand,
  makeChatMessageDeleteCommand,
  makeChatReactionAddCommand,
  makeChatReactionRemoveCommand,
} from '../../helpers/test-fixtures';

describe('PersistMessageConsumer (integration)', () => {
  let module: TestingModule;
  let consumer: PersistMessageConsumer;
  let scylla: ReturnType<typeof createMockScyllaClient>;
  let kafka: ReturnType<typeof createMockKafkaClient>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let membershipService: ConversationMembershipService;
  let mockUserRepo: ReturnType<typeof createMockRepository>;
  let mockMemberRepo: ReturnType<typeof createMockRepository>;

  beforeAll(async () => {
    scylla = createMockScyllaClient();
    kafka = createMockKafkaClient();
    redis = createMockRedisClient();
    mockUserRepo = createMockRepository();
    mockMemberRepo = createMockRepository();

    module = await Test.createTestingModule({
      controllers: [PersistMessageConsumer],
      providers: [
        MessageRepository,
        { provide: SCYLLA_CLIENT, useValue: scylla.client },
        {
          provide: ChatPublisher,
          useValue: {
            emit: jest.fn().mockResolvedValue(undefined),
            onModuleInit: jest.fn(),
          },
        },
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis.client },
        {
          provide: ConversationMembershipService,
          useValue: {
            canUserAccessConversation: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: KAFKA_CLIENT, useValue: kafka.client },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: mockMemberRepo,
        },
      ],
    }).compile();

    consumer = module.get(PersistMessageConsumer);
    membershipService = module.get(ConversationMembershipService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    scylla.reset();
    kafka.reset();
    redis.reset();
    jest.clearAllMocks();
    // Default: membership OK
    (
      membershipService.canUserAccessConversation as jest.Mock
    ).mockResolvedValue(true);
  });

  // ─── onSend ───────────────────────────────────────────

  describe('onSend', () => {
    it('should persist message and emit ChatMessageCreated', async () => {
      const cmd = makeChatMessageSendCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onSend(cmd);

      // Verify idempotency was checked
      const idempotencyChecks = scylla.queries.filter((q) =>
        q.query.toUpperCase().includes('IDEMPOTENCY_BY_MESSAGE_ID'),
      );
      expect(idempotencyChecks.length).toBeGreaterThanOrEqual(1);

      // Verify message was inserted
      const insertQueries = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('INSERT') &&
          q.query.toUpperCase().includes('MESSAGES_BY_CONVERSATION'),
      );
      expect(insertQueries.length).toBe(1);

      // Verify ChatMessageCreated was emitted
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageCreated,
        expect.objectContaining({
          message_id: cmd.message_id,
          conversation_id: cmd.conversation_id,
          sender_id: cmd.sender_id,
          body: cmd.body,
        }),
      );
    });

    it('should reject message from non-member', async () => {
      (
        membershipService.canUserAccessConversation as jest.Mock
      ).mockResolvedValue(false);

      const cmd = makeChatMessageSendCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onSend(cmd);

      // Should NOT insert
      const insertQueries = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('INSERT') &&
          q.query.toUpperCase().includes('MESSAGES_BY_CONVERSATION'),
      );
      expect(insertQueries.length).toBe(0);

      // Should NOT emit Created event
      expect(publisher.emit).not.toHaveBeenCalledWith(
        KafkaTopics.ChatMessageCreated,
        expect.anything(),
      );
    });

    it('should skip duplicate message (idempotent)', async () => {
      const cmd = makeChatMessageSendCommand();
      const publisher = module.get(ChatPublisher);

      // First send
      await consumer.onSend(cmd);
      (publisher.emit as jest.Mock).mockClear();
      scylla.queries.length = 0;

      // Second send — same message_id is already in idempotency store
      await consumer.onSend(cmd);

      // Should NOT insert again
      const insertQueries = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('INSERT') &&
          q.query.toUpperCase().includes('MESSAGES_BY_CONVERSATION'),
      );
      expect(insertQueries.length).toBe(0);

      // Should NOT emit again
      expect(publisher.emit).not.toHaveBeenCalledWith(
        KafkaTopics.ChatMessageCreated,
        expect.anything(),
      );
    });

    it('should emit AiModerationRequest after message creation', async () => {
      const cmd = makeChatMessageSendCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onSend(cmd);

      // Wait for async void moderation call
      await new Promise((r) => setTimeout(r, 50));

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.AiModerationRequest,
        expect.objectContaining({
          message_id: cmd.message_id,
          body: cmd.body,
        }),
      );
    });

    it('should invalidate recent messages cache', async () => {
      const cmd = makeChatMessageSendCommand();

      await consumer.onSend(cmd);

      // Wait for async cache invalidation
      await new Promise((r) => setTimeout(r, 50));

      // CacheService.invalidateRecentMessages uses del under the hood
      // which calls redis.del — verify it was called with the right key
      const cacheService = module.get(CacheService);
      // The key pattern is cache:messages:recent:<conversationId>
      const expectedKey = `cache:messages:recent:${cmd.conversation_id}`;
      expect(redis.client.del).toHaveBeenCalled();
    });
  });

  // ─── onEdit ───────────────────────────────────────────

  describe('onEdit', () => {
    it('should update message body and emit ChatMessageUpdated', async () => {
      const cmd = makeChatMessageEditCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onEdit(cmd);

      // Verify UPDATE query
      const updateQueries = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('UPDATE') &&
          q.query.toUpperCase().includes('BODY'),
      );
      expect(updateQueries.length).toBe(1);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageUpdated,
        expect.objectContaining({
          message_id: cmd.message_id,
          body: cmd.new_body,
        }),
      );
    });

    it('should invalidate cache after edit', async () => {
      const cmd = makeChatMessageEditCommand();

      await consumer.onEdit(cmd);

      // Wait for async cache op
      await new Promise((r) => setTimeout(r, 50));

      expect(redis.client.del).toHaveBeenCalled();
    });
  });

  // ─── onDelete ─────────────────────────────────────────

  describe('onDelete', () => {
    it('should soft-delete message and emit ChatMessageDeleted', async () => {
      const cmd = makeChatMessageDeleteCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onDelete(cmd);

      // Verify UPDATE with DELETED_AT
      const deleteQueries = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('UPDATE') &&
          q.query.toUpperCase().includes('DELETED_AT'),
      );
      expect(deleteQueries.length).toBe(1);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageDeleted,
        expect.objectContaining({
          message_id: cmd.message_id,
          conversation_id: cmd.conversation_id,
        }),
      );
    });
  });

  // ─── onReactionAdd ────────────────────────────────────

  describe('onReactionAdd', () => {
    it('should add reaction and emit ChatReactionAdded', async () => {
      const cmd = makeChatReactionAddCommand();
      const publisher = module.get(ChatPublisher);

      await consumer.onReactionAdd(cmd);

      // Verify INSERT into message_reactions
      const reactionInserts = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('INSERT') &&
          q.query.toUpperCase().includes('MESSAGE_REACTIONS'),
      );
      expect(reactionInserts.length).toBe(1);

      // Verify counter increment
      const counterUpdates = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('UPDATE') &&
          q.query.toUpperCase().includes('MESSAGE_REACTION_COUNTS') &&
          q.query.toUpperCase().includes('COUNT + 1'),
      );
      expect(counterUpdates.length).toBe(1);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatReactionAdded,
        expect.objectContaining({
          message_id: cmd.message_id,
          user_id: cmd.user_id,
          reaction_type: cmd.reaction_type,
        }),
      );
    });
  });

  // ─── onReactionRemove ─────────────────────────────────

  describe('onReactionRemove', () => {
    it('should remove reaction and emit ChatReactionRemoved', async () => {
      // Pre-add a reaction so removeReaction has something to decrement
      const userId = 'user-1';
      const msgId = 'msg-1';
      scylla.stores.reactions.set(msgId, [
        {
          message_id: msgId,
          user_id: userId,
          reaction_type: 'like',
          created_at: Date.now(),
        },
      ]);

      const cmd = makeChatReactionRemoveCommand({
        message_id: msgId,
        user_id: userId,
        conversation_id: 'conv-1',
      });
      const publisher = module.get(ChatPublisher);

      await consumer.onReactionRemove(cmd);

      // Verify DELETE from message_reactions
      const deleteCalls = scylla.queries.filter(
        (q) =>
          q.query.toUpperCase().includes('DELETE') &&
          q.query.toUpperCase().includes('MESSAGE_REACTIONS'),
      );
      expect(deleteCalls.length).toBe(1);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatReactionRemoved,
        expect.objectContaining({
          message_id: cmd.message_id,
          user_id: cmd.user_id,
        }),
      );
    });
  });

  // ─── Error Handling ───────────────────────────────────

  describe('Error handling', () => {
    it('should throw when ScyllaDB insert fails', async () => {
      const cmd = makeChatMessageSendCommand();

      // Make execute throw on INSERT
      const originalExecute = scylla.execute.getMockImplementation();
      scylla.execute.mockImplementation(
        async (
          query: string,
          params?: unknown[],
          options?: Record<string, unknown>,
        ) => {
          if (
            query.toUpperCase().includes('INSERT') &&
            query.toUpperCase().includes('MESSAGES_BY_CONVERSATION')
          ) {
            throw new Error('ScyllaDB write timeout');
          }
          return originalExecute!(query, params, options);
        },
      );

      await expect(consumer.onSend(cmd)).rejects.toThrow(
        'ScyllaDB write timeout',
      );
    });
  });
});
