/**
 * @file poll-metadata.builder.ts (interaction-service)
 *
 * Injectable helper that (re)builds a fresh `PollMessageMetadata` snapshot
 * for a poll's chat message and publishes a `ChatPollMessageUpdated` event
 * via the outbox.
 *
 * Extracted from `ConversationPollService` so that both the poll service
 * and the new `ConversationVoteService` (Tasks 12-14) can share a single
 * authoritative implementation of the snapshot/emit logic.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollStatus } from '@app/constant';
import {
  KafkaTopics,
  type ChatPollMessageUpdatedEvent,
  type PollMessageMetadata,
} from '@libs/contracts';
import {
  ConversationPoll,
  ConversationPollVote,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';

@Injectable()
export class PollMetadataBuilder {
  constructor(
    @InjectRepository(ConversationPoll)
    private readonly pollRepo: Repository<ConversationPoll>,
    private readonly outbox: NotificationOutboxPublisher,
  ) {}

  /**
   * Build a fresh PollMessageMetadata snapshot for a poll's chat message.
   * Returns null if the poll does not exist or has no linked messageId.
   */
  async build(pollId: string): Promise<{
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
  async emitUpdated(pollId: string, traceId: string): Promise<void> {
    const snapshot = await this.build(pollId);
    if (!snapshot) {
      return;
    }

    const event: ChatPollMessageUpdatedEvent = {
      message_id: snapshot.messageId,
      conversation_id: snapshot.conversationId,
      metadata: snapshot.payload,
      trace_id: traceId,
    };

    await this.outbox.publishToTopic(KafkaTopics.ChatPollMessageUpdated, event);
  }
}
