import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationCoreService } from './services/conversation-core.service';
import { ConversationMemberService } from './services/conversation-member.service';
import { GroupInviteService } from './services/group-invite.service';
import { ConversationPollService } from './services/conversation-poll.service';
import { ConversationVoteService } from './services/conversation-vote.service';
import { PollMetadataBuilder } from './services/poll-metadata.builder';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Conversation,
      ConversationMember,
      ConversationInvite,
      ConversationPoll,
      ConversationPollOption,
      ConversationPollVote,
    ]),
    KafkaModule,
    NotificationOutboxModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationCoreService,
    ConversationMemberService,
    GroupInviteService,
    ConversationPollService,
    ConversationVoteService,
    PollMetadataBuilder,
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
