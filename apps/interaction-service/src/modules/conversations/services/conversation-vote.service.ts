import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  ConversationMember,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import { ErrorCode, PollClosedReason, PollStatus } from '@app/constant';
import { BusinessException } from '@app/types';
import {
  KafkaTopics,
  type ConversationPollClosedEvent,
  type ConversationPollVoteCastEvent,
  type ConversationPollVoteRetractedEvent,
} from '@libs/contracts';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { PollMetadataBuilder } from './poll-metadata.builder';

export interface CastVoteResult {
  poll_id: string;
  option_ids_added: string[];
  option_ids_removed: string[];
}

export interface RetractVoteResult {
  poll_id: string;
  deleted: number;
}

class LazyExpiredSentinel extends Error {
  readonly _expired = true as const;
  constructor(public readonly conversationId: string) {
    super('lazy_expired_close');
  }
}

@Injectable()
export class ConversationVoteService {
  private readonly logger = new Logger(ConversationVoteService.name);

  constructor(
    @InjectRepository(ConversationPoll)
    private readonly pollRepo: Repository<ConversationPoll>,
    @InjectRepository(ConversationPollOption)
    private readonly optionRepo: Repository<ConversationPollOption>,
    @InjectRepository(ConversationPollVote)
    private readonly voteRepo: Repository<ConversationPollVote>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    private readonly outbox: NotificationOutboxPublisher,
    private readonly metadataBuilder: PollMetadataBuilder,
  ) {}

  async castVote(
    userId: string,
    pollId: string,
    requestedOptionIds: string[],
  ): Promise<CastVoteResult> {
    const dedupedIds = Array.from(new Set(requestedOptionIds ?? []));
    if (dedupedIds.length === 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const traceId = randomUUID();

    type TxResult =
      | { conversationId: string; added: string[]; removed: string[] }
      | LazyExpiredSentinel;

    let result: TxResult;
    try {
      result = await this.pollRepo.manager.transaction(async (mgr) => {
        const poll = await mgr.findOne(ConversationPoll, {
          where: { id: pollId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!poll) {
          throw new BusinessException(
            ErrorCode.POLL_NOT_FOUND,
            ErrorCode.POLL_NOT_FOUND,
          );
        }

        if (poll.status === PollStatus.CLOSED) {
          throw BusinessException.conflict(ErrorCode.POLL_CLOSED);
        }

        if (poll.expiresAt && poll.expiresAt.getTime() <= Date.now()) {
          await mgr.update(
            ConversationPoll,
            { id: pollId, status: PollStatus.ACTIVE },
            {
              status: PollStatus.CLOSED,
              closedAt: new Date(),
              closedByUserId: null,
              closedReason: PollClosedReason.EXPIRED,
            },
          );
          throw new LazyExpiredSentinel(poll.conversationId);
        }

        if (!poll.allowMultiple && dedupedIds.length > 1) {
          throw BusinessException.badRequest(
            ErrorCode.POLL_SINGLE_CHOICE_VIOLATION,
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

        const validOptions = await mgr.find(ConversationPollOption, {
          where: {
            pollId,
            deletedAt: IsNull() as unknown as Date,
          },
        });
        const validIds = new Set(validOptions.map((o) => o.id));
        for (const id of dedupedIds) {
          if (!validIds.has(id)) {
            throw BusinessException.badRequest(ErrorCode.POLL_INVALID_OPTION);
          }
        }

        const currentRows: Array<{ option_id: string }> = await mgr.query(
          `SELECT option_id FROM conversation_poll_votes WHERE poll_id = $1 AND user_id = $2`,
          [pollId, userId],
        );
        const currentIds = new Set<string>(currentRows.map((r) => r.option_id));

        const added = dedupedIds.filter((id) => !currentIds.has(id));
        const removed = [...currentIds].filter(
          (id) => !dedupedIds.includes(id),
        );

        if (removed.length > 0) {
          await mgr.query(
            `DELETE FROM conversation_poll_votes WHERE poll_id = $1 AND user_id = $2 AND option_id = ANY($3::uuid[])`,
            [pollId, userId, removed],
          );
        }

        if (added.length > 0) {
          await mgr
            .createQueryBuilder()
            .insert()
            .into(ConversationPollVote)
            .values(
              added.map((oid) => ({
                pollId,
                optionId: oid,
                userId,
              })),
            )
            .orIgnore()
            .execute();
        }

        return {
          conversationId: poll.conversationId,
          added,
          removed,
        };
      });
    } catch (err) {
      if (err instanceof LazyExpiredSentinel) {
        result = err;
      } else {
        throw err;
      }
    }

    if (result instanceof LazyExpiredSentinel) {
      const sentinel = result;
      const closedAtMs = Date.now();
      const closedEvent: ConversationPollClosedEvent = {
        poll_id: pollId,
        conversation_id: sentinel.conversationId,
        closed_by_user_id: null,
        reason: 'expired',
        final_tally: [],
        closed_at: closedAtMs,
        trace_id: traceId,
      };
      await this.outbox.publishToTopic(
        KafkaTopics.ConversationPollClosed,
        closedEvent,
      );
      await this.metadataBuilder.emitUpdated(pollId, traceId);
      throw BusinessException.conflict(ErrorCode.POLL_EXPIRED);
    }

    const normal = result as {
      conversationId: string;
      added: string[];
      removed: string[];
    };

    const voteCastEvent: ConversationPollVoteCastEvent = {
      poll_id: pollId,
      conversation_id: normal.conversationId,
      voter_id: userId,
      option_ids_added: normal.added,
      option_ids_removed: normal.removed,
      voted_at: Date.now(),
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(
      KafkaTopics.ConversationPollVoteCast,
      voteCastEvent,
    );

    await this.metadataBuilder.emitUpdated(pollId, traceId);

    return {
      poll_id: pollId,
      option_ids_added: normal.added,
      option_ids_removed: normal.removed,
    };
  }

  async retractVote(
    userId: string,
    pollId: string,
  ): Promise<RetractVoteResult> {
    const poll = await this.pollRepo.findOne({ where: { id: pollId } });
    if (!poll) {
      throw new BusinessException(
        ErrorCode.POLL_NOT_FOUND,
        ErrorCode.POLL_NOT_FOUND,
      );
    }

    if (poll.status !== PollStatus.ACTIVE) {
      throw BusinessException.conflict(ErrorCode.POLL_CLOSED);
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

    const deleteResult = await this.voteRepo.delete({ pollId, userId });
    const affected = deleteResult.affected ?? 0;

    if (affected > 0) {
      const traceId = randomUUID();
      const retractedEvent: ConversationPollVoteRetractedEvent = {
        poll_id: pollId,
        conversation_id: poll.conversationId,
        voter_id: userId,
        retracted_at: Date.now(),
        trace_id: traceId,
      };
      await this.outbox.publishToTopic(
        KafkaTopics.ConversationPollVoteRetracted,
        retractedEvent,
      );
      await this.metadataBuilder.emitUpdated(pollId, traceId);
    }

    return {
      poll_id: pollId,
      deleted: affected,
    };
  }
}
