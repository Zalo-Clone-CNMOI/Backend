/**
 * @file conversation-vote.service.ts (interaction-service)
 *
 * Service for casting/retracting poll votes and reading poll state in a
 * group conversation. Task 11 scaffolds DI only; Tasks 12-14 will add
 * `castVote`, `retractVote`, `listPolls`, and `getPollDetail`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationMember,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { PollMetadataBuilder } from './poll-metadata.builder';

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
}
