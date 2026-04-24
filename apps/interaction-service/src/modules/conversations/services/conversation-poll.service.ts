/**
 * @file conversation-poll.service.ts (interaction-service)
 *
 * Service skeleton for group conversation polls/votes. Methods
 * (createPoll, closePoll, addOption, editPoll, removeOption) are
 * implemented in follow-up tasks (8, 9, 10, 10b, 10c).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
  Conversation,
  ConversationMember,
} from '@libs/database/entities';

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
}
