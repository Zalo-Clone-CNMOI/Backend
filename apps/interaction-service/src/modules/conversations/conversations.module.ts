import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationCoreService } from './services/conversation-core.service';
import { ConversationMemberService } from './services/conversation-member.service';
import { GroupInviteService } from './services/group-invite.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Conversation,
      ConversationMember,
      ConversationInvite,
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
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
