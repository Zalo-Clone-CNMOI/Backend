/**
 * @file conversation-poll.service.ts (interaction-service)
 *
 * Service for group conversation polls/votes. Task 8 implements
 * `createPoll`. Follow-up tasks will add closePoll, addOption,
 * editPoll, removeOption.
 */
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  ConversationType,
  ErrorCode,
  MessageType,
  POLL_LIMITS,
  PollStatus,
} from '@app/constant';
import { BusinessException } from '@app/types';
import {
  KafkaTopics,
  type ChatPollMessageCommand,
  type ConversationPollCreatedEvent,
  type PollMessageMetadata,
} from '@libs/contracts';
import {
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
  Conversation,
  ConversationMember,
} from '@libs/database/entities';

export interface CreatePollInput {
  question: string;
  options: Array<{ label: string }>;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_in_hours?: number | null;
  is_anonymous?: boolean;
}

export interface CreatePollResult {
  poll_id: string;
  message_id: string;
  options: Array<{ option_id: string; label: string; order_index: number }>;
}

@Injectable()
export class ConversationPollService {
  private readonly logger = new Logger(ConversationPollService.name);

  constructor(
    @InjectRepository(ConversationPoll)
    private readonly pollRepo: Repository<ConversationPoll>,
    @InjectRepository(ConversationPollOption)
    private readonly optionRepo: Repository<ConversationPollOption>,
    @InjectRepository(ConversationPollVote)
    private readonly voteRepo: Repository<ConversationPollVote>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    private readonly outbox: NotificationOutboxPublisher,
  ) {}

  /**
   * Create a new poll in a group conversation.
   *
   * Preconditions:
   *  - Conversation must exist AND be of type GROUP.
   *  - Caller must be an active member (leftAt IS NULL) of the conversation.
   *  - dto.options must contain between POLL_LIMITS.MIN_OPTIONS and
   *    POLL_LIMITS.MAX_OPTIONS unique (trimmed) labels.
   *
   * Side effects (post-commit):
   *  - Emits KafkaTopics.ConversationPollCreated outbox event.
   *  - Emits KafkaTopics.ChatPollMessageCreated outbox event.
   *
   * v1 guard: `is_anonymous` is always forced to `false` regardless of
   * what the caller passes (anonymous polls are deferred).
   */
  async createPoll(
    userId: string,
    conversationId: string,
    dto: CreatePollInput,
  ): Promise<CreatePollResult> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation || conversation.type !== ConversationType.GROUP) {
      throw BusinessException.badRequest(
        ErrorCode.POLL_NOT_GROUP_CONVERSATION,
      );
    }

    const membership = await this.memberRepo.findOne({
      where: {
        conversationId,
        userId,
        leftAt: IsNull(),
      },
    });

    if (!membership) {
      throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const trimmedLabels = (dto.options ?? [])
      .map((o) => (o?.label ?? '').trim())
      .filter((label) => label.length > 0);

    if (trimmedLabels.length < POLL_LIMITS.MIN_OPTIONS) {
      throw BusinessException.badRequest(ErrorCode.POLL_MIN_OPTIONS_REQUIRED);
    }

    if (trimmedLabels.length > POLL_LIMITS.MAX_OPTIONS) {
      throw BusinessException.badRequest(ErrorCode.POLL_OPTION_LIMIT_REACHED);
    }

    const uniqueLabels = new Set(trimmedLabels);
    if (uniqueLabels.size !== trimmedLabels.length) {
      throw BusinessException.badRequest(ErrorCode.POLL_DUPLICATE_OPTION_LABEL);
    }

    const trimmedQuestion = (dto.question ?? '').trim();
    const messageId = randomUUID();
    const expiresAt =
      dto.expires_in_hours && dto.expires_in_hours > 0
        ? new Date(Date.now() + dto.expires_in_hours * 3600_000)
        : null;
    const allowMultiple = dto.allow_multiple === true;
    const allowAddOption = dto.allow_add_option === true;

    const { savedPoll, savedOptions } = await this.pollRepo.manager.transaction(
      async (manager) => {
        const pollDraft = manager.create(ConversationPoll, {
          conversationId,
          creatorId: userId,
          question: trimmedQuestion,
          allowMultiple,
          allowAddOption,
          isAnonymous: false,
          status: PollStatus.ACTIVE,
          expiresAt,
          messageId,
        });

        const persistedPoll = (await manager.save(
          ConversationPoll,
          pollDraft,
        )) as ConversationPoll;

        const optionDrafts = trimmedLabels.map((label, idx) =>
          manager.create(ConversationPollOption, {
            pollId: persistedPoll.id,
            label,
            orderIndex: idx,
            addedByUserId: userId,
          }),
        );

        const persistedOptions = (await manager.save(
          ConversationPollOption,
          optionDrafts,
        )) as ConversationPollOption[];

        return { savedPoll: persistedPoll, savedOptions: persistedOptions };
      },
    );

    const createdAtMs = Date.now();
    const optionSummaries = savedOptions.map((opt) => ({
      option_id: opt.id,
      label: opt.label,
      order_index: opt.orderIndex,
    }));

    const pollCreatedEvent: ConversationPollCreatedEvent = {
      poll_id: savedPoll.id,
      conversation_id: conversationId,
      creator_id: userId,
      question: trimmedQuestion,
      options: optionSummaries,
      allow_multiple: allowMultiple,
      allow_add_option: allowAddOption,
      expires_at: expiresAt ? expiresAt.getTime() : null,
      created_at: createdAtMs,
      message_id: messageId,
      trace_id: `conversation-poll-created:${savedPoll.id}`,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollCreated,
      pollCreatedEvent,
    );

    const pollMetadata: PollMessageMetadata = {
      poll_id: savedPoll.id,
      question: trimmedQuestion,
      options: savedOptions.map((opt) => ({
        option_id: opt.id,
        label: opt.label,
        order_index: opt.orderIndex,
        vote_count: 0,
      })),
      total_votes: 0,
      total_voters: 0,
      allow_multiple: allowMultiple,
      allow_add_option: allowAddOption,
      status: 'active',
      expires_at: expiresAt ? expiresAt.getTime() : null,
      closed_at: null,
      closed_reason: null,
    };

    const pollMessageCommand: ChatPollMessageCommand = {
      message_id: messageId,
      conversation_id: conversationId,
      sender_id: userId,
      message_type: MessageType.POLL,
      metadata: pollMetadata,
      body: `📊 ${trimmedQuestion}`,
      created_at: createdAtMs,
      trace_id: `chat-poll-message-created:${savedPoll.id}`,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ChatPollMessageCreated,
      pollMessageCommand,
    );

    return {
      poll_id: savedPoll.id,
      message_id: messageId,
      options: optionSummaries,
    };
  }
}
