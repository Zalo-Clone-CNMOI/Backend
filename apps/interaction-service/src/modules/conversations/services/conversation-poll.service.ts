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
  NotificationType,
  type ChatPollMessageCommand,
  type ConversationPollClosedEvent,
  type ConversationPollCreatedEvent,
  type ConversationPollEditedEvent,
  type ConversationPollOptionAddedEvent,
  type ConversationPollOptionRemovedEvent,
  type NotificationRequestedEvent,
  type PollMessageMetadata,
} from '@libs/contracts';
import {
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
  Conversation,
  ConversationMember,
  User,
} from '@libs/database/entities';
import { PollMetadataBuilder } from './poll-metadata.builder';
import { enqueueNotifications } from '../helper/conversations-notification.helper';

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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly outbox: NotificationOutboxPublisher,
    private readonly metadataBuilder: PollMetadataBuilder,
  ) {}

  async createPoll(
    userId: string,
    conversationId: string,
    dto: CreatePollInput,
  ): Promise<CreatePollResult> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation || conversation.type !== ConversationType.GROUP) {
      throw BusinessException.badRequest(ErrorCode.POLL_NOT_GROUP_CONVERSATION);
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

        const persistedPoll = await manager.save(ConversationPoll, pollDraft);

        const optionDrafts = trimmedLabels.map((label, idx) =>
          manager.create(ConversationPollOption, {
            pollId: persistedPoll.id,
            label,
            orderIndex: idx,
            addedByUserId: userId,
          }),
        );

        const persistedOptions = await manager.save(
          ConversationPollOption,
          optionDrafts,
        );

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

    try {
      const creator = await this.userRepo.findOne({ where: { id: userId } });
      const creatorName = creator?.fullName ?? 'Someone';
      const title = `${creatorName} started a poll`;
      const body = trimmedQuestion;

      const notifications = await this.buildPollNotifications({
        conversationId,
        excludeUserId: userId,
        pollId: savedPoll.id,
        title,
        body,
        notificationType: NotificationType.GroupPoll,
        category: 'group_poll',
        traceIdPrefix: `group-poll-created:${savedPoll.id}`,
      });

      await enqueueNotifications(
        notifications,
        `group_poll_created:${savedPoll.id}`,
        this.outbox,
        this.logger,
      );
    } catch (err: unknown) {
      this.logger.error(
        `[ConversationPollService] notify-on-create failed poll_id=${savedPoll.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      poll_id: savedPoll.id,
      message_id: messageId,
      options: optionSummaries,
    };
  }

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

    try {
      let title = 'Poll has ended';
      if (effectiveReason === PollClosedReason.BY_CREATOR) {
        const creator = await this.userRepo.findOne({
          where: { id: poll.creatorId },
        });
        const creatorName = creator?.fullName ?? 'The creator';
        title = `${creatorName} ended the poll`;
      } else if (effectiveReason === PollClosedReason.BY_ADMIN) {
        title = 'An admin ended the poll';
      }

      const notifications = await this.buildPollNotifications({
        conversationId: poll.conversationId,
        excludeUserId: closedByUserId,
        pollId,
        title,
        body: poll.question,
        notificationType: NotificationType.GroupPollClosed,
        category: 'group_poll',
        traceIdPrefix: `group-poll-closed:${pollId}`,
      });

      await enqueueNotifications(
        notifications,
        `group_poll_closed:${pollId}`,
        this.outbox,
        this.logger,
      );
    } catch (err: unknown) {
      this.logger.error(
        `[ConversationPollService] notify-on-close failed poll_id=${pollId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { poll_id: pollId, status: 'closed', final_tally: tally };
  }

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
      throw new BusinessException(ErrorCode.POLL_CLOSED, ErrorCode.POLL_CLOSED);
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
      throw new BusinessException(ErrorCode.POLL_CLOSED, ErrorCode.POLL_CLOSED);
    }

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

    if (dto.question !== undefined) {
      const trimmedQ = dto.question.trim();
      if (trimmedQ !== poll.question) {
        changes.question = trimmedQ;
        pollPatch.question = trimmedQ;
      }
    }

    if (
      dto.allow_add_option !== undefined &&
      dto.allow_add_option !== poll.allowAddOption
    ) {
      changes.allow_add_option = dto.allow_add_option;
      pollPatch.allowAddOption = dto.allow_add_option;
    }

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
      throw new BusinessException(ErrorCode.POLL_CLOSED, ErrorCode.POLL_CLOSED);
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

  private async buildPollNotifications(args: {
    conversationId: string;
    excludeUserId: string | null;
    pollId: string;
    title: string;
    body: string;
    notificationType: NotificationType;
    category: string;
    traceIdPrefix: string;
  }): Promise<NotificationRequestedEvent[]> {
    const members = await this.memberRepo.find({
      where: {
        conversationId: args.conversationId,
        leftAt: IsNull(),
      },
    });

    const recipientIds = members
      .map((m) => m.userId)
      .filter((id) => !!id && id !== args.excludeUserId);

    if (recipientIds.length === 0) {
      return [];
    }

    const requestedAt = Date.now();
    return recipientIds.map<NotificationRequestedEvent>((recipientId) => ({
      channel: 'push',
      user_id: recipientId,
      title: args.title,
      body: args.body,
      type: args.notificationType,
      data: {
        poll_id: args.pollId,
        conversation_id: args.conversationId,
      },
      rich: {
        priority: 'normal',
        category: args.category,
        thread_id: args.conversationId,
      },
      requested_at: requestedAt,
      trace_id: `${args.traceIdPrefix}:${recipientId}`,
    }));
  }

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
