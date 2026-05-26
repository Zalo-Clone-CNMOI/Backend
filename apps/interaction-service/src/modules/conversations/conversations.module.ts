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
  DocumentMetadata,
} from '@libs/database/entities';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { RedisModule } from '@libs/redis';
import { ConversationsController } from './conversations.controller';
import { AiConversationController } from './ai-conversation.controller';
import { ConversationsService } from './conversations.service';
import { ConversationCoreService } from './services/conversation-core.service';
import { ConversationMemberService } from './services/conversation-member.service';
import { GroupInviteService } from './services/group-invite.service';
import { ConversationPollService } from './services/conversation-poll.service';
import { ConversationVoteService } from './services/conversation-vote.service';
import { PollMetadataBuilder } from './services/poll-metadata.builder';
import { AiConversationFactoryService } from './services/ai-conversation-factory.service';

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
      DocumentMetadata,
    ]),
    KafkaModule,
    NotificationOutboxModule,
    RedisModule,
  ],
  controllers: [ConversationsController, AiConversationController],
  providers: [
    ConversationsService,
    ConversationCoreService,
    ConversationMemberService,
    GroupInviteService,
    ConversationPollService,
    ConversationVoteService,
    PollMetadataBuilder,
    AiConversationFactoryService,
  ],
  exports: [ConversationsService, AiConversationFactoryService],
})
export class ConversationsModule {}
