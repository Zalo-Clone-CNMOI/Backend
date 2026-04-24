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
  type ConversationPollClosedEvent,
  type ConversationPollCreatedEvent,
  type ConversationPollEditedEvent,
  type ConversationPollOptionAddedEvent,
  type ConversationPollOptionRemovedEvent,
  type PollMessageMetadata,
} from '@libs/contracts';
import {
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
  Conversation,
  ConversationMember,
} from '@libs/database/entities';
import { PollMetadataBuilder } from './poll-metadata.builder';

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

export interface EditPollDto {
  question?: string;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_at?: string | null;
  edited_option_labels?: Array<{ option_id: string; label: string }>;
}

export interface EditPollResult {
  poll_id: string;
  edited_at: number;
}

export interface RemoveOptionResult {
  option_id: string;
}

export interface ListPollsQuery {
  status?: PollStatus;
  page?: number;
  limit?: number;
}

export interface PollListItem {
  poll_id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  status: PollStatus;
  allow_multiple: boolean;
  allow_add_option: boolean;
  expires_at: number | null;
  closed_at: number | null;
  created_at: number | undefined;
  options_count: number;
}

export interface ListPollsResult {
  items: PollListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PollDetailOption {
  option_id: string;
  label: string;
  order_index: number;
  vote_count: number;
  added_by_user_id: string | null;
}

export interface PollDetailResult {
  poll_id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  status: PollStatus;
  allow_multiple: boolean;
  allow_add_option: boolean;
  expires_at: number | null;
  closed_at: number | null;
  options: PollDetailOption[];
  my_vote: string[];
  total_votes: number;
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
    private readonly metadataBuilder: PollMetadataBuilder,
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

    await this.metadataBuilder.emitUpdated(pollId, traceId);

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

    await this.metadataBuilder.emitUpdated(pollId, traceId);

    return {
      option_id: saved.id,
      label: saved.label,
      order_index: saved.orderIndex,
    };
  }

  /**
   * Edit an active poll (Option A edit scope).
   *
   * Only the poll creator may edit. Allowed mutations:
   *  - question (string)
   *  - allow_multiple (forbidden when any vote exists)
   *  - allow_add_option
   *  - expires_at (ISO8601 string, or null to clear). Must be strictly > now.
   *  - edited_option_labels: rename existing options. Each option must belong
   *    to the poll (not soft-deleted) and have no votes; otherwise rejected.
   *
   * Preconditions:
   *  - DTO must carry at least one listed field; else POLL_NO_EDIT_FIELDS.
   *  - Poll must exist and be ACTIVE; closed/missing polls are rejected.
   *
   * Side effects (post-commit):
   *  - KafkaTopics.ConversationPollEdited outbox event with `changes` diff.
   *  - KafkaTopics.ChatPollMessageUpdated outbox event (refreshed metadata).
   */
  async editPoll(
    userId: string,
    pollId: string,
    dto: EditPollDto,
  ): Promise<EditPollResult> {
    const hasAnyField =
      !!dto &&
      (dto.question !== undefined ||
        dto.allow_multiple !== undefined ||
        dto.allow_add_option !== undefined ||
        dto.expires_at !== undefined ||
        (Array.isArray(dto.edited_option_labels) &&
          dto.edited_option_labels.length > 0));

    if (!hasAnyField) {
      throw new BusinessException(
        ErrorCode.POLL_NO_EDIT_FIELDS,
        ErrorCode.POLL_NO_EDIT_FIELDS,
      );
    }

    const poll = await this.pollRepo.findOne({ where: { id: pollId } });
    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    if (poll.creatorId !== userId) {
      throw new BusinessException(
        ErrorCode.POLL_PERMISSION_DENIED,
        ErrorCode.POLL_PERMISSION_DENIED,
      );
    }

    if (poll.status !== PollStatus.ACTIVE) {
      throw new BusinessException(
        ErrorCode.POLL_CLOSED,
        ErrorCode.POLL_CLOSED,
      );
    }

    // Parse / validate expires_at if present.
    let nextExpiresAt: Date | null | undefined = undefined;
    if (dto.expires_at !== undefined) {
      if (dto.expires_at === null) {
        nextExpiresAt = null;
      } else {
        const parsed = new Date(dto.expires_at);
        if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
          throw new BusinessException(
            ErrorCode.POLL_EXPIRES_AT_IN_PAST,
            ErrorCode.POLL_EXPIRES_AT_IN_PAST,
          );
        }
        nextExpiresAt = parsed;
      }
    }

    const changes: ConversationPollEditedEvent['changes'] = {};
    const pollPatch: Partial<ConversationPoll> = {};

    // allow_multiple diff (with votes guard)
    if (
      dto.allow_multiple !== undefined &&
      dto.allow_multiple !== poll.allowMultiple
    ) {
      const voteCount = await this.voteRepo.count({ where: { pollId } });
      if (voteCount > 0) {
        throw new BusinessException(
          ErrorCode.POLL_CANNOT_EDIT_MULTIPLE_WITH_VOTES,
          ErrorCode.POLL_CANNOT_EDIT_MULTIPLE_WITH_VOTES,
        );
      }
      changes.allow_multiple = dto.allow_multiple;
      pollPatch.allowMultiple = dto.allow_multiple;
    }

    // edited_option_labels: validate all BEFORE recording any change.
    const normalizedLabelEdits: Array<{ option_id: string; label: string }> =
      [];
    if (
      Array.isArray(dto.edited_option_labels) &&
      dto.edited_option_labels.length > 0
    ) {
      for (const edit of dto.edited_option_labels) {
        const trimmedLabel = (edit?.label ?? '').trim();
        const option = await this.optionRepo.findOne({
          where: {
            id: edit.option_id,
            pollId,
            deletedAt: IsNull() as unknown as Date,
          },
        });
        if (!option) {
          throw new BusinessException(
            ErrorCode.POLL_INVALID_OPTION,
            ErrorCode.POLL_INVALID_OPTION,
          );
        }
        const optionVotes = await this.voteRepo.count({
          where: { pollId, optionId: edit.option_id },
        });
        if (optionVotes > 0) {
          throw new BusinessException(
            ErrorCode.POLL_CANNOT_EDIT_OPTION_WITH_VOTES,
            ErrorCode.POLL_CANNOT_EDIT_OPTION_WITH_VOTES,
          );
        }
        normalizedLabelEdits.push({
          option_id: edit.option_id,
          label: trimmedLabel,
        });
      }
      if (normalizedLabelEdits.length > 0) {
        changes.edited_option_labels = normalizedLabelEdits;
      }
    }

    // question diff
    if (dto.question !== undefined) {
      const trimmedQ = dto.question.trim();
      if (trimmedQ !== poll.question) {
        changes.question = trimmedQ;
        pollPatch.question = trimmedQ;
      }
    }

    // allow_add_option diff
    if (
      dto.allow_add_option !== undefined &&
      dto.allow_add_option !== poll.allowAddOption
    ) {
      changes.allow_add_option = dto.allow_add_option;
      pollPatch.allowAddOption = dto.allow_add_option;
    }

    // expires_at diff (undefined means "not provided"; null means "clear")
    if (nextExpiresAt !== undefined) {
      changes.expires_at = nextExpiresAt ? nextExpiresAt.getTime() : null;
      pollPatch.expiresAt = nextExpiresAt;
    }

    const editedAt = new Date();
    const traceId = `conversation-poll-edited:${pollId}:${editedAt.getTime()}`;

    await this.pollRepo.manager.transaction(async (manager) => {
      await manager.update(
        ConversationPoll,
        { id: pollId },
        { ...pollPatch, editedAt },
      );

      for (const labelEdit of normalizedLabelEdits) {
        await manager.update(
          ConversationPollOption,
          { id: labelEdit.option_id, pollId },
          { label: labelEdit.label },
        );
      }
    });

    const editedEvent: ConversationPollEditedEvent = {
      poll_id: pollId,
      conversation_id: poll.conversationId,
      editor_user_id: userId,
      changes,
      edited_at: editedAt.getTime(),
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollEdited,
      editedEvent,
    );

    await this.metadataBuilder.emitUpdated(pollId, traceId);

    return {
      poll_id: pollId,
      edited_at: editedAt.getTime(),
    };
  }

  /**
   * Soft-delete an option from an active poll.
   *
   * Preconditions:
   *  - Poll must exist (else POLL_NOT_FOUND).
   *  - Caller must be the creator (else POLL_PERMISSION_DENIED).
   *  - Poll must be ACTIVE (else POLL_CLOSED).
   *  - Option must belong to the poll and not already be soft-deleted
   *    (else POLL_INVALID_OPTION).
   *  - Option must have zero votes
   *    (else POLL_CANNOT_EDIT_OPTION_WITH_VOTES).
   *  - Removing this option must not drop the active option count below
   *    POLL_LIMITS.MIN_OPTIONS (else POLL_MIN_OPTIONS_REQUIRED).
   *
   * Side effects (post-commit):
   *  - KafkaTopics.ConversationPollOptionRemoved outbox event.
   *  - KafkaTopics.ChatPollMessageUpdated outbox event (refreshed metadata).
   */
  async removeOption(
    userId: string,
    pollId: string,
    optionId: string,
  ): Promise<RemoveOptionResult> {
    const poll = await this.pollRepo.findOne({ where: { id: pollId } });
    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    if (poll.creatorId !== userId) {
      throw new BusinessException(
        ErrorCode.POLL_PERMISSION_DENIED,
        ErrorCode.POLL_PERMISSION_DENIED,
      );
    }

    if (poll.status !== PollStatus.ACTIVE) {
      throw new BusinessException(
        ErrorCode.POLL_CLOSED,
        ErrorCode.POLL_CLOSED,
      );
    }

    const option = await this.optionRepo.findOne({
      where: {
        id: optionId,
        pollId,
        deletedAt: IsNull() as unknown as Date,
      },
    });
    if (!option) {
      throw BusinessException.badRequest(ErrorCode.POLL_INVALID_OPTION);
    }

    const optionVotes = await this.voteRepo.count({
      where: { pollId, optionId },
    });
    if (optionVotes > 0) {
      throw BusinessException.conflict(
        ErrorCode.POLL_CANNOT_EDIT_OPTION_WITH_VOTES,
      );
    }

    const activeOptionCount = await this.optionRepo.count({
      where: { pollId, deletedAt: IsNull() as unknown as Date },
    });
    if (activeOptionCount <= POLL_LIMITS.MIN_OPTIONS) {
      throw BusinessException.conflict(ErrorCode.POLL_MIN_OPTIONS_REQUIRED);
    }

    await this.optionRepo.softDelete({ id: optionId });

    const removedAtMs = Date.now();
    const traceId = `conversation-poll-option-removed:${optionId}:${removedAtMs}`;

    const optionRemovedEvent: ConversationPollOptionRemovedEvent = {
      poll_id: pollId,
      conversation_id: poll.conversationId,
      option_id: optionId,
      removed_by_user_id: userId,
      removed_at: removedAtMs,
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollOptionRemoved,
      optionRemovedEvent,
    );

    await this.metadataBuilder.emitUpdated(pollId, traceId);

    return { option_id: optionId };
  }

  /**
   * List polls in a conversation with pagination + optional status filter.
   *
   * Preconditions:
   *  - Caller must be an active member of the conversation. Non-members
   *    get CONVERSATION_NOT_MEMBER (forbidden).
   *
   * Pagination is clamped: page >= 1, 1 <= limit <= 50 (default 20).
   * Results are ordered by createdAt DESC. Each item's `options_count`
   * excludes soft-deleted options.
   */
  async listPolls(
    userId: string,
    conversationId: string,
    query: ListPollsQuery,
  ): Promise<ListPollsResult> {
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

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));

    const [rows, total] = await this.pollRepo.findAndCount({
      where: {
        conversationId,
        ...(query.status ? { status: query.status } : {}),
      },
      relations: ['options'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const items: PollListItem[] = rows.map((p) => ({
      poll_id: p.id,
      conversation_id: p.conversationId,
      creator_id: p.creatorId,
      question: p.question,
      status: p.status,
      allow_multiple: p.allowMultiple,
      allow_add_option: p.allowAddOption,
      expires_at: p.expiresAt?.getTime() ?? null,
      closed_at: p.closedAt?.getTime() ?? null,
      created_at: p.createdAt?.getTime(),
      options_count: (p.options ?? []).filter((o) => !o.deletedAt).length,
    }));

    return { items, total, page, limit };
  }

  /**
   * Return full detail for a single poll — options (with tally), caller's
   * votes, and total_votes.
   *
   * Preconditions:
   *  - Poll must exist (else POLL_NOT_FOUND).
   *  - Caller must be an active member of the poll's conversation
   *    (else CONVERSATION_NOT_MEMBER forbidden).
   *
   * Soft-deleted options are filtered out. `my_vote` contains the
   * optionIds the caller has voted for (empty array when none).
   * `total_votes` is the sum of per-option vote counts across active
   * (non-deleted) options — note: votes attached to soft-deleted options
   * are excluded from the visible tally.
   */
  async getPollDetail(
    userId: string,
    pollId: string,
  ): Promise<PollDetailResult> {
    const poll = await this.pollRepo.findOne({
      where: { id: pollId },
      relations: ['options'],
    });

    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    const membership = await this.memberRepo.findOne({
      where: {
        conversationId: poll.conversationId,
        userId,
        leftAt: IsNull(),
      },
    });

    if (!membership) {
      throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const myVotes = await this.voteRepo.find({ where: { pollId, userId } });
    const tally = await this.loadTally(pollId);

    const options: PollDetailOption[] = (poll.options ?? [])
      .filter((o) => !o.deletedAt)
      .map((o) => ({
        option_id: o.id,
        label: o.label,
        order_index: o.orderIndex,
        vote_count: tally.get(o.id) ?? 0,
        added_by_user_id: o.addedByUserId,
      }))
      .sort((a, b) => a.order_index - b.order_index);

    const total_votes = options.reduce((sum, o) => sum + o.vote_count, 0);

    return {
      poll_id: poll.id,
      conversation_id: poll.conversationId,
      creator_id: poll.creatorId,
      question: poll.question,
      status: poll.status,
      allow_multiple: poll.allowMultiple,
      allow_add_option: poll.allowAddOption,
      expires_at: poll.expiresAt?.getTime() ?? null,
      closed_at: poll.closedAt?.getTime() ?? null,
      options,
      my_vote: myVotes.map((v) => v.optionId),
      total_votes,
    };
  }

  /**
   * Load per-option vote counts for a poll.
   *
   * Returns a Map keyed by option_id with the vote count as a number.
   * Options with zero votes are absent from the map (callers should
   * fall back to 0).
   */
  private async loadTally(pollId: string): Promise<Map<string, number>> {
    const rows = await this.pollRepo.manager
      .createQueryBuilder()
      .select('option_id', 'option_id')
      .addSelect('COUNT(*)', 'count')
      .from('conversation_poll_votes', 'v')
      .where('v.poll_id = :pid', { pid: pollId })
      .groupBy('option_id')
      .getRawMany<{ option_id: string; count: string }>();
    return new Map(rows.map((r) => [r.option_id, Number(r.count)]));
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

}
