/**
 * Unit tests for PollMessageConsumer (chat-service)
 *
 * Covers:
 *  - onPollMessageCreated: happy path, idempotent skip, error path lock-clear.
 *  - onPollMessageUpdated: happy path and "message not found" early return.
 */
import { PollMessageConsumer } from '../poll-message.consumer';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import type { MessageRepository } from '@libs/scylla';
import type { CacheService } from '@libs/redis';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';
import type {
  ChatPollMessageCommand,
  ChatPollMessageUpdatedEvent,
  PollMessageMetadata,
} from '@libs/contracts';

const buildMetadata = (
  overrides: Partial<PollMessageMetadata> = {},
): PollMessageMetadata => ({
  poll_id: 'poll-1',
  question: 'Lunch?',
  options: [
    { option_id: 'opt-1', label: 'Pizza', order_index: 0, vote_count: 0 },
    { option_id: 'opt-2', label: 'Sushi', order_index: 1, vote_count: 0 },
  ],
  total_votes: 0,
  total_voters: 0,
  allow_multiple: false,
  allow_add_option: false,
  status: 'active',
  expires_at: null,
  closed_at: null,
  closed_reason: null,
  ...overrides,
});

describe('PollMessageConsumer', () => {
  let consumer: PollMessageConsumer;
  let shared: MessageConsumerSharedService;
  let repo: {
    tryBeginMessageProcessing: jest.Mock;
    insertPollMessage: jest.Mock;
    markMessageStored: jest.Mock;
    clearMessageProcessing: jest.Mock;
    getMessageById: jest.Mock;
    updateMessageMetadata: jest.Mock;
  };
  let cacheService: { invalidateRecentMessages: jest.Mock };
  let publisher: { emit: jest.Mock };
  let notificationPublisher: { publish: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let conversationMemberRepo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(() => {
    repo = {
      tryBeginMessageProcessing: jest.fn(),
      insertPollMessage: jest.fn().mockResolvedValue(undefined),
      markMessageStored: jest.fn().mockResolvedValue(undefined),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
      getMessageById: jest.fn(),
      updateMessageMetadata: jest.fn().mockResolvedValue(undefined),
    };

    cacheService = {
      invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    publisher = { emit: jest.fn().mockResolvedValue(undefined) };
    notificationPublisher = { publish: jest.fn().mockResolvedValue('ok') };
    userRepo = { findOne: jest.fn(), find: jest.fn() };
    conversationMemberRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

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

    consumer = new PollMessageConsumer(
      repo as unknown as MessageRepository,
      cacheService as unknown as CacheService,
      shared,
    );
  });

  // ─── onPollMessageCreated ────────────────────────────────────────────────

  describe('onPollMessageCreated', () => {
    const baseCommand = (): ChatPollMessageCommand => ({
      message_id: 'msg-poll-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      message_type: 'poll',
      metadata: buildMetadata(),
      body: '📊 Lunch?',
      created_at: 1_700_000_000_000,
      trace_id: 'trace-poll-1',
    });

    it('persists poll message, marks stored, and invalidates cache (happy path)', async () => {
      const cmd = baseCommand();
      repo.tryBeginMessageProcessing.mockResolvedValue(true);

      await consumer.onPollMessageCreated(cmd);

      expect(repo.tryBeginMessageProcessing).toHaveBeenCalledWith(
        cmd.message_id,
        cmd.conversation_id,
        cmd.created_at,
      );
      expect(repo.insertPollMessage).toHaveBeenCalledWith({
        message_id: cmd.message_id,
        conversation_id: cmd.conversation_id,
        sender_id: cmd.sender_id,
        message_type: cmd.message_type,
        metadata: cmd.metadata,
        body: cmd.body,
        created_at: cmd.created_at,
      });
      expect(repo.markMessageStored).toHaveBeenCalledWith(cmd.message_id);
      expect(cacheService.invalidateRecentMessages).toHaveBeenCalledWith(
        cmd.conversation_id,
      );
      expect(repo.clearMessageProcessing).not.toHaveBeenCalled();
    });

    it('skips work when idempotency lock is not acquired', async () => {
      const cmd = baseCommand();
      repo.tryBeginMessageProcessing.mockResolvedValue(false);

      await consumer.onPollMessageCreated(cmd);

      expect(repo.insertPollMessage).not.toHaveBeenCalled();
      expect(repo.markMessageStored).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });

    it('clears the processing lock and rethrows when insert fails', async () => {
      const cmd = baseCommand();
      repo.tryBeginMessageProcessing.mockResolvedValue(true);
      repo.insertPollMessage.mockRejectedValue(
        new Error('Scylla write failed'),
      );

      await expect(consumer.onPollMessageCreated(cmd)).rejects.toThrow(
        'Scylla write failed',
      );

      expect(repo.clearMessageProcessing).toHaveBeenCalledWith(cmd.message_id);
      expect(repo.markMessageStored).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });
  });

  // ─── onPollMessageUpdated ────────────────────────────────────────────────

  describe('onPollMessageUpdated', () => {
    const baseEvent = (): ChatPollMessageUpdatedEvent => ({
      message_id: 'msg-poll-1',
      conversation_id: 'conv-1',
      metadata: buildMetadata({ total_votes: 1, total_voters: 1 }),
      trace_id: 'trace-poll-update-1',
    });

    it('updates Scylla metadata and invalidates cache when message exists', async () => {
      const evt = baseEvent();
      const createdAt = 1_700_000_000_000;
      repo.getMessageById.mockResolvedValue({
        conversation_id: evt.conversation_id,
        created_at: createdAt,
      });

      await consumer.onPollMessageUpdated(evt);

      expect(repo.getMessageById).toHaveBeenCalledWith(evt.message_id);
      expect(repo.updateMessageMetadata).toHaveBeenCalledWith(
        evt.conversation_id,
        createdAt,
        evt.message_id,
        evt.metadata,
      );
      expect(cacheService.invalidateRecentMessages).toHaveBeenCalledWith(
        evt.conversation_id,
      );
    });

    it('returns early without updating when the message lookup misses', async () => {
      const evt = baseEvent();
      repo.getMessageById.mockResolvedValue(null);

      await consumer.onPollMessageUpdated(evt);

      expect(repo.updateMessageMetadata).not.toHaveBeenCalled();
      expect(cacheService.invalidateRecentMessages).not.toHaveBeenCalled();
    });
  });
});
