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
  PollClosedReason,
  PollStatus,
  UpdateMemberRoleDtoRoleEnum,
} from '@app/constant';
import { BusinessException } from '@app/types';
import {
  KafkaTopics,
  type ChatPollMessageCommand,
  type ChatPollMessageUpdatedEvent,
  type ConversationPollClosedEvent,
  type ConversationPollCreatedEvent,
  type ConversationPollOptionAddedEvent,
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

export interface ClosePollResult {
  poll_id: string;
  status: 'closed';
  final_tally: Array<{ option_id: string; vote_count: number }>;
}

export interface AddOptionResult {
  option_id: string;
  label: string;
  order_index: number;
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

  /**
   * Close an active poll.
   *
   * Behavior:
   *  - POLL_NOT_FOUND if poll does not exist.
   *  - Idempotent: if already CLOSED, returns the same shape with empty
   *    final_tally and emits no events.
   *  - Creator always allowed (keeps passed-in reason, default BY_CREATOR).
   *  - Active group members with role owner/admin allowed; reason forced to
   *    BY_ADMIN regardless of caller input.
   *  - Otherwise POLL_PERMISSION_DENIED.
   *  - Uses an optimistic-status `UPDATE ... WHERE status = ACTIVE` inside a
   *    TX; affected=0 means another actor closed first -> POLL_CLOSED.
   *
   * Post-commit side effects:
   *  - KafkaTopics.ConversationPollClosed outbox event with the final tally.
   *  - KafkaTopics.ChatPollMessageUpdated outbox event carrying the refreshed
   *    PollMessageMetadata snapshot for the chat message card.
   */
  async closePoll(
    userId: string,
    pollId: string,
    reason: PollClosedReason = PollClosedReason.BY_CREATOR,
  ): Promise<ClosePollResult> {
    const poll = await this.pollRepo.findOne({ where: { id: pollId } });

    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    if (poll.status === PollStatus.CLOSED) {
      return { poll_id: pollId, status: 'closed', final_tally: [] };
    }

    let effectiveReason: PollClosedReason = reason;

    if (userId !== poll.creatorId) {
      const membership = await this.memberRepo.findOne({
        where: {
          conversationId: poll.conversationId,
          userId,
          leftAt: IsNull(),
        },
      });

      const isPrivileged =
        !!membership &&
        (membership.role === UpdateMemberRoleDtoRoleEnum.OWNER ||
          membership.role === UpdateMemberRoleDtoRoleEnum.ADMIN);

      if (!isPrivileged) {
        throw BusinessException.forbidden(ErrorCode.POLL_PERMISSION_DENIED);
      }

      effectiveReason = PollClosedReason.BY_ADMIN;
    }

    const closedAt = new Date();
    const traceId = randomUUID();
    const closedByUserId =
      effectiveReason === PollClosedReason.EXPIRED ? null : userId;

    const tally = await this.pollRepo.manager.transaction(async (manager) => {
      const updateResult = await manager.update(
        ConversationPoll,
        { id: pollId, status: PollStatus.ACTIVE },
        {
          status: PollStatus.CLOSED,
          closedAt,
          closedByUserId,
          closedReason: effectiveReason,
        },
      );

      if (updateResult.affected !== 1) {
        throw BusinessException.conflict(ErrorCode.POLL_CLOSED);
      }

      const rows = await manager
        .createQueryBuilder()
        .select('option_id', 'option_id')
        .addSelect('COUNT(*)', 'count')
        .from(ConversationPollVote, 'v')
        .where('v.poll_id = :pid', { pid: pollId })
        .groupBy('option_id')
        .getRawMany<{ option_id: string; count: string | number }>();

      return rows.map((row) => ({
        option_id: row.option_id,
        vote_count: Number(row.count),
      }));
    });

    const closedEvent: ConversationPollClosedEvent = {
      poll_id: pollId,
      conversation_id: poll.conversationId,
      closed_by_user_id: closedByUserId,
      reason: effectiveReason,
      final_tally: tally,
      closed_at: closedAt.getTime(),
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollClosed,
      closedEvent,
    );

    await this.emitMessageUpdate(pollId, traceId);

    return { poll_id: pollId, status: 'closed', final_tally: tally };
  }

  /**
   * Add a new option to an existing active poll.
   *
   * Preconditions:
   *  - label must be a non-empty string after trimming.
   *  - poll must exist and be ACTIVE.
   *  - poll.allowAddOption must be true.
   *  - caller must be an active member of the poll's conversation.
   *  - poll must have fewer than POLL_LIMITS.MAX_OPTIONS active options.
   *  - label must be unique within the poll (enforced both in app logic
   *    and via a Postgres unique constraint -> 23505).
   *
   * Side effects (post-commit):
   *  - KafkaTopics.ConversationPollOptionAdded outbox event.
   *  - KafkaTopics.ChatPollMessageUpdated outbox event (refreshed metadata).
   */
  async addOption(
    userId: string,
    pollId: string,
    label: string,
  ): Promise<AddOptionResult> {
    const trimmed = (label ?? '').trim();
    if (trimmed.length === 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const poll = await this.pollRepo.findOne({ where: { id: pollId } });
    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    if (poll.status !== PollStatus.ACTIVE) {
      throw new BusinessException(
        ErrorCode.POLL_CLOSED,
        ErrorCode.POLL_CLOSED,
      );
    }

    if (!poll.allowAddOption) {
      throw BusinessException.forbidden(ErrorCode.POLL_ADD_OPTION_NOT_ALLOWED);
    }

    const membership = await this.memberRepo.findOne({
      where: {
        conversationId: poll.conversationId,
        userId,
        leftAt: IsNull(),
      },
    });

    if (!membership) {
      throw new BusinessException(
        ErrorCode.CONVERSATION_NOT_MEMBER,
        ErrorCode.CONVERSATION_NOT_MEMBER,
      );
    }

    const existingCount = await this.optionRepo.count({ where: { pollId } });
    if (existingCount >= POLL_LIMITS.MAX_OPTIONS) {
      throw BusinessException.conflict(ErrorCode.POLL_OPTION_LIMIT_REACHED);
    }

    let saved: ConversationPollOption;
    try {
      saved = await this.optionRepo.save(
        this.optionRepo.create({
          pollId,
          label: trimmed,
          orderIndex: existingCount,
          addedByUserId: userId,
        }),
      );
    } catch (err: unknown) {
      if (this.isUniqueViolationError(err)) {
        throw new BusinessException(
          ErrorCode.POLL_DUPLICATE_OPTION_LABEL,
          ErrorCode.POLL_DUPLICATE_OPTION_LABEL,
        );
      }
      throw err;
    }

    const addedAtMs = Date.now();
    const traceId = `conversation-poll-option-added:${saved.id}`;

    const optionAddedEvent: ConversationPollOptionAddedEvent = {
      poll_id: pollId,
      conversation_id: poll.conversationId,
      option_id: saved.id,
      label: saved.label,
      order_index: saved.orderIndex,
      added_by_user_id: userId,
      added_at: addedAtMs,
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollOptionAdded,
      optionAddedEvent,
    );

    await this.emitMessageUpdate(pollId, traceId);

    return {
      option_id: saved.id,
      label: saved.label,
      order_index: saved.orderIndex,
    };
  }

  /**
   * Detects a Postgres unique-constraint violation. Handles both:
   *   - Raw driver errors with `.code === '23505'`
   *   - TypeORM QueryFailedError wrapping `driverError.code === '23505'`
   */
  private isUniqueViolationError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }
    const anyErr = err as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    if (anyErr.code === '23505') {
      return true;
    }
    if (anyErr.driverError && anyErr.driverError.code === '23505') {
      return true;
    }
    return false;
  }

  /**
   * Build a fresh PollMessageMetadata snapshot for a poll's chat message.
   * Returns null if the poll does not exist or has no linked messageId.
   */
  private async buildMetadataSnapshot(pollId: string): Promise<{
    messageId: string;
    conversationId: string;
    payload: PollMessageMetadata;
  } | null> {
    const poll = await this.pollRepo.findOne({
      where: { id: pollId },
      relations: ['options'],
    });

    if (!poll || !poll.messageId) {
      return null;
    }

    const tallyRows = await this.pollRepo.manager
      .createQueryBuilder()
      .select('option_id', 'option_id')
      .addSelect('COUNT(*)', 'count')
      .from(ConversationPollVote, 'v')
      .where('v.poll_id = :pid', { pid: pollId })
      .groupBy('option_id')
      .getRawMany<{ option_id: string; count: string | number }>();

    const tallyByOption = new Map<string, number>();
    for (const row of tallyRows) {
      tallyByOption.set(row.option_id, Number(row.count));
    }

    const voterRow = await this.pollRepo.manager
      .createQueryBuilder()
      .select('COUNT(DISTINCT user_id)', 'n')
      .addSelect('1', '_pad')
      .from(ConversationPollVote, 'v')
      .where('v.poll_id = :pid', { pid: pollId })
      .getRawOne<{ n: string | number }>();

    const totalVoters = voterRow ? Number(voterRow.n) : 0;

    const options = (poll.options ?? [])
      .filter((opt) => !opt.deletedAt)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((opt) => ({
        option_id: opt.id,
        label: opt.label,
        order_index: opt.orderIndex,
        vote_count: tallyByOption.get(opt.id) ?? 0,
      }));

    const totalVotes = options.reduce((sum, o) => sum + o.vote_count, 0);

    const payload: PollMessageMetadata = {
      poll_id: poll.id,
      question: poll.question,
      options,
      total_votes: totalVotes,
      total_voters: totalVoters,
      allow_multiple: poll.allowMultiple,
      allow_add_option: poll.allowAddOption,
      status: poll.status === PollStatus.CLOSED ? 'closed' : 'active',
      expires_at: poll.expiresAt ? poll.expiresAt.getTime() : null,
      closed_at: poll.closedAt ? poll.closedAt.getTime() : null,
      closed_reason: poll.closedReason ?? null,
    };

    return {
      messageId: poll.messageId,
      conversationId: poll.conversationId,
      payload,
    };
  }

  /**
   * Emit a ChatPollMessageUpdated event carrying a refreshed poll metadata
   * snapshot. No-op if the poll or its message cannot be found.
   */
  private async emitMessageUpdate(
    pollId: string,
    traceId: string,
  ): Promise<void> {
    const snapshot = await this.buildMetadataSnapshot(pollId);
    if (!snapshot) {
      return;
    }

    const event: ChatPollMessageUpdatedEvent = {
      message_id: snapshot.messageId,
      conversation_id: snapshot.conversationId,
      metadata: snapshot.payload,
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ChatPollMessageUpdated,
      event,
    );
  }
}
