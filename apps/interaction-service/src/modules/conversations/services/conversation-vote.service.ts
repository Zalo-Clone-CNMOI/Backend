/**
 * @file conversation-vote.service.ts (interaction-service)
 *
 * Service for casting/retracting poll votes and reading poll state in a
 * group conversation. Task 12 implements `castVote`. Follow-up tasks
 * (13-14) will add `retractVote`, `listPolls`, and `getPollDetail`.
 */
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

/**
 * Sentinel error thrown by the castVote transaction body when the poll's
 * `expires_at` has passed and we've just flipped it to CLOSED inside the
 * TX. It is NOT a BusinessException — we catch it OUTSIDE the TX to emit
 * the ConversationPollClosed event and refreshed metadata, then throw a
 * user-facing POLL_EXPIRED conflict. This avoids emitting side effects from
 * within the transaction.
 */
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

  /**
   * Cast (or replace) a user's vote in a poll.
   *
   * Semantics:
   *  - `requestedOptionIds` is the FULL desired vote set (not a patch).
   *    Duplicates are deduped. An empty list is rejected (use retractVote).
   *  - For single-choice polls (`allowMultiple=false`), only one id allowed.
   *  - The poll row is loaded with a pessimistic_write lock so concurrent
   *    voters cannot race past the expires_at / status check.
   *  - Lazy-expired close: if `expires_at` has passed and the poll is still
   *    ACTIVE, flip it to CLOSED(reason=EXPIRED) inside the TX and bubble a
   *    sentinel out so the caller-visible side effects (closed event +
   *    metadata refresh + POLL_EXPIRED error) happen post-commit.
   *  - Vote diff is computed against the user's current vote set:
   *      added   = desired \ current
   *      removed = current \ desired
   *    Removes are DELETEd; adds are upserted via INSERT ... ON CONFLICT DO
   *    NOTHING (orIgnore) to tolerate unique-key races under concurrency.
   *
   * Post-commit side effects:
   *  - KafkaTopics.ConversationPollVoteCast outbox event.
   *  - `PollMetadataBuilder.emitUpdated(pollId, traceId)` refreshes the
   *    chat-message metadata card.
   */
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

        // Lazy-expired close: flip row to CLOSED and signal via sentinel.
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
          // Not a BusinessException: this is caught by the outer try and
          // triggers the POLL_EXPIRED side effects outside the TX.
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

        // Fetch current user vote set.
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

  /**
   * Retract all of `userId`'s votes in the given poll.
   *
   * Semantics:
   *  - Poll must exist (POLL_NOT_FOUND) and be ACTIVE (POLL_CLOSED).
   *  - Caller must be a current conversation member (CONVERSATION_NOT_MEMBER).
   *  - Deletes every vote row for (pollId, userId). Tally is implicit —
   *    downstream metadata rebuild reads the live DB state.
   *  - If nothing was deleted (user had no votes), the call is a no-op: no
   *    event is emitted and the metadata card is not republished. The caller
   *    still gets `{ deleted: 0 }` so the API is idempotent.
   *
   * Post-commit side effects (only when `affected > 0`):
   *  - KafkaTopics.ConversationPollVoteRetracted outbox event.
   *  - `PollMetadataBuilder.emitUpdated(pollId, traceId)` refreshes the
   *    chat-message metadata card.
   */
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
