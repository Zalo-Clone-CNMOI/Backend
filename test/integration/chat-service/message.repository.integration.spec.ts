/**
 * @file message.repository.integration.spec.ts
 *
 * Integration tests for MessageRepository with in-memory ScyllaDB mock.
 * Uses real NestJS DI to wire the repository with a mock Cassandra Client.
 *
 * Tests cover:
 *  - Idempotency (wasMessageSeen / markMessageSeen)
 *  - Message CRUD (insert, get, pagination, update, soft-delete)
 *  - Reactions (add, remove, getReactions, getReactionsByUser, stats)
 *  - Cursor-based pagination
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessageRepository } from '@libs/scylla';
import { SCYLLA_CLIENT } from '@libs/scylla/scylla.tokens';
import { createMockScyllaClient } from '../../helpers/mock-scylla.helper';
import { v4 as uuid } from 'uuid';

describe('MessageRepository (integration)', () => {
  let module: TestingModule;
  let repo: MessageRepository;
  let scylla: ReturnType<typeof createMockScyllaClient>;

  beforeAll(async () => {
    scylla = createMockScyllaClient();

    module = await Test.createTestingModule({
      providers: [
        MessageRepository,
        { provide: SCYLLA_CLIENT, useValue: scylla.client },
      ],
    }).compile();

    repo = module.get(MessageRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    scylla.reset();
  });

  // ─── Idempotency ─────────────────────────────────────

  describe('Idempotency', () => {
    it('should return false for unseen message', async () => {
      const result = await repo.wasMessageSeen(uuid());
      expect(result).toBe(false);
    });

    it('should return true after marking message as seen', async () => {
      const messageId = uuid();
      const conversationId = uuid();
      const createdAt = Date.now();

      const applied = await repo.markMessageSeen(
        messageId,
        conversationId,
        createdAt,
      );
      const result = await repo.wasMessageSeen(messageId);

      expect(applied).toBe(true);
      expect(result).toBe(true);
    });

    it('should apply seen marker only once under concurrent writes', async () => {
      const messageId = uuid();
      const conversationId = uuid();
      const createdAt = Date.now();

      const appliedResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          repo.markMessageSeen(messageId, conversationId, createdAt),
        ),
      );

      const appliedCount = appliedResults.filter(Boolean).length;
      expect(appliedCount).toBe(1);
      expect(await repo.wasMessageSeen(messageId)).toBe(true);
    });

    it('should reject duplicate begin-processing and preserve original created_at', async () => {
      const messageId = uuid();
      const conversationId = uuid();
      const firstCreatedAt = Date.now();
      const secondCreatedAt = firstCreatedAt + 1000;

      const firstAcquire = await repo.tryBeginMessageProcessing(
        messageId,
        conversationId,
        firstCreatedAt,
      );
      const secondAcquire = await repo.tryBeginMessageProcessing(
        messageId,
        conversationId,
        secondCreatedAt,
      );
      const state = await repo.getMessageProcessingState(messageId);

      expect(firstAcquire).toBe(true);
      expect(secondAcquire).toBe(false);
      expect(state).toEqual(
        expect.objectContaining({
          message_id: messageId,
          conversation_id: conversationId,
          created_at: firstCreatedAt,
          status: 'pending',
        }),
      );
    });

    it('should track idempotency per message_id', async () => {
      const msgA = uuid();
      const msgB = uuid();
      const convId = uuid();

      await repo.markMessageSeen(msgA, convId, Date.now());

      expect(await repo.wasMessageSeen(msgA)).toBe(true);
      expect(await repo.wasMessageSeen(msgB)).toBe(false);
    });
  });

  // ─── Message Insert & Retrieve ────────────────────────

  describe('Insert & Retrieve', () => {
    it('should insert and retrieve a message by exact key', async () => {
      const convId = uuid();
      const msgId = uuid();
      const senderId = uuid();
      const now = Date.now();

      await repo.insertMessage({
        conversation_id: convId,
        message_id: msgId,
        sender_id: senderId,
        body: 'Hello world',
        created_at: now,
      });

      const result = await repo.getMessage(convId, now, msgId);

      expect(result).not.toBeNull();
      expect(result!.message_id).toBe(msgId);
      expect(result!.conversation_id).toBe(convId);
      expect(result!.sender_id).toBe(senderId);
      expect(result!.body).toBe('Hello world');
      expect(result!.created_at).toBe(now);
    });

    it('should return null for non-existent message', async () => {
      const result = await repo.getMessage(uuid(), Date.now(), uuid());
      expect(result).toBeNull();
    });

    it('should handle message with attachments', async () => {
      const convId = uuid();
      const msgId = uuid();
      const now = Date.now();
      const attachments = [
        {
          key: 'file-1',
          type: 'image' as const,
          name: 'photo.jpg',
          size: 1024,
          content_type: 'image/jpeg',
        },
      ];

      await repo.insertMessage({
        conversation_id: convId,
        message_id: msgId,
        sender_id: uuid(),
        body: 'Check this image',
        created_at: now,
        attachments,
      });

      // The message is stored — verify via execute call count
      expect(scylla.execute).toHaveBeenCalled();
      const insertCalls = scylla.queries.filter((q) =>
        q.query.toUpperCase().includes('INSERT INTO MESSAGES_BY_CONVERSATION'),
      );
      expect(insertCalls.length).toBe(1);
    });

    it('should handle message with reply_to_message_id', async () => {
      const convId = uuid();
      const originalMsgId = uuid();
      const replyMsgId = uuid();
      const now = Date.now();

      await repo.insertMessage({
        conversation_id: convId,
        message_id: originalMsgId,
        sender_id: uuid(),
        body: 'Original',
        created_at: now,
      });

      await repo.insertMessage({
        conversation_id: convId,
        message_id: replyMsgId,
        sender_id: uuid(),
        body: 'Reply',
        created_at: now + 1,
        reply_to_message_id: originalMsgId,
      });

      const reply = await repo.getMessage(convId, now + 1, replyMsgId);
      expect(reply).not.toBeNull();
      expect(reply!.reply_to_message_id).toBe(originalMsgId);
    });
  });

  // ─── Pagination ──────────────────────────────────────

  describe('Pagination', () => {
    it('should return messages in descending order', async () => {
      const convId = uuid();
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        await repo.insertMessage({
          conversation_id: convId,
          message_id: uuid(),
          sender_id: uuid(),
          body: `Message ${i}`,
          created_at: baseTime + i * 1000,
        });
      }

      const result = await repo.getMessages(convId, { limit: 10 });

      expect(result.items.length).toBe(5);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
      // Verify descending order
      for (let i = 0; i < result.items.length - 1; i++) {
        expect(result.items[i].created_at).toBeGreaterThan(
          result.items[i + 1].created_at,
        );
      }
    });

    it('should respect limit and return has_more + cursor', async () => {
      const convId = uuid();
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        await repo.insertMessage({
          conversation_id: convId,
          message_id: uuid(),
          sender_id: uuid(),
          body: `Message ${i}`,
          created_at: baseTime + i * 1000,
        });
      }

      const page1 = await repo.getMessages(convId, { limit: 3 });

      expect(page1.items.length).toBe(3);
      expect(page1.has_more).toBe(true);
      expect(page1.next_cursor).not.toBeNull();
    });

    it('should return empty result for unknown conversation', async () => {
      const result = await repo.getMessages(uuid(), { limit: 10 });

      expect(result.items).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });
  });

  // ─── Update & Delete ─────────────────────────────────

  describe('Update & Delete', () => {
    it('should update message body and set edited_at', async () => {
      const convId = uuid();
      const msgId = uuid();
      const now = Date.now();

      await repo.insertMessage({
        conversation_id: convId,
        message_id: msgId,
        sender_id: uuid(),
        body: 'Original body',
        created_at: now,
      });

      const editedAt = now + 5000;
      await repo.updateMessageBody(
        convId,
        now,
        msgId,
        'Updated body',
        editedAt,
      );

      const updated = await repo.getMessage(convId, now, msgId);
      expect(updated).not.toBeNull();
      expect(updated!.body).toBe('Updated body');
      expect(updated!.edited_at).toBe(editedAt);
    });

    it('should soft-delete message (clear body, set deleted_at)', async () => {
      const convId = uuid();
      const msgId = uuid();
      const now = Date.now();

      await repo.insertMessage({
        conversation_id: convId,
        message_id: msgId,
        sender_id: uuid(),
        body: 'Will be deleted',
        created_at: now,
      });

      const deletedAt = now + 5000;
      await repo.softDeleteMessage(convId, now, msgId, deletedAt);

      const deleted = await repo.getMessage(convId, now, msgId);
      expect(deleted).not.toBeNull();
      expect(deleted!.body).toBe('');
      expect(deleted!.deleted_at).toBe(deletedAt);
    });
  });

  // ─── Reactions ────────────────────────────────────────

  describe('Reactions', () => {
    it('should add and retrieve a reaction', async () => {
      const msgId = uuid();
      const userId = uuid();

      await repo.addReaction({
        message_id: msgId,
        user_id: userId,
        reaction_type: 'like',
        created_at: Date.now(),
      });

      const reactions = await repo.getReactions(msgId);
      expect(reactions.length).toBe(1);
      expect(reactions[0].user_id).toBe(userId);
      expect(reactions[0].reaction_type).toBe('like');
    });

    it('should get reactions filtered by user', async () => {
      const msgId = uuid();
      const userA = uuid();
      const userB = uuid();

      await repo.addReaction({
        message_id: msgId,
        user_id: userA,
        reaction_type: 'like',
        created_at: Date.now(),
      });
      await repo.addReaction({
        message_id: msgId,
        user_id: userB,
        reaction_type: 'love',
        created_at: Date.now(),
      });

      const userAReactions = await repo.getReactionsByUser(msgId, userA);
      expect(userAReactions.length).toBe(1);
      expect(userAReactions[0].reaction_type).toBe('like');
    });

    it('should remove reaction and decrement counter', async () => {
      const msgId = uuid();
      const userId = uuid();

      await repo.addReaction({
        message_id: msgId,
        user_id: userId,
        reaction_type: 'like',
        created_at: Date.now(),
      });

      await repo.removeReaction(msgId, userId);

      const reactions = await repo.getReactions(msgId);
      expect(reactions.length).toBe(0);
    });

    it('should track reaction stats per type', async () => {
      const msgId = uuid();

      await repo.addReaction({
        message_id: msgId,
        user_id: uuid(),
        reaction_type: 'like',
        created_at: Date.now(),
      });
      await repo.addReaction({
        message_id: msgId,
        user_id: uuid(),
        reaction_type: 'like',
        created_at: Date.now(),
      });
      await repo.addReaction({
        message_id: msgId,
        user_id: uuid(),
        reaction_type: 'love',
        created_at: Date.now(),
      });

      const stats = await repo.getReactionStats(msgId);
      expect(stats).not.toBeNull();
      expect(stats!['like']).toBe(2);
      expect(stats!['love']).toBe(1);
    });

    it('should return null stats for message with no reactions', async () => {
      const stats = await repo.getReactionStats(uuid());
      expect(stats).toBeNull();
    });
  });

  // ─── CQL Query Tracking ──────────────────────────────

  describe('Query Tracking', () => {
    it('should record all CQL queries for audit', async () => {
      const convId = uuid();
      const msgId = uuid();

      await repo.insertMessage({
        conversation_id: convId,
        message_id: msgId,
        sender_id: uuid(),
        body: 'Test',
        created_at: Date.now(),
      });

      expect(scylla.queries.length).toBeGreaterThan(0);
      const insertQueries = scylla.queries.filter((q) =>
        q.query.toUpperCase().includes('INSERT'),
      );
      expect(insertQueries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
