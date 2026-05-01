import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Conversation,
  ConversationMember,
  Friendship,
} from '@libs/database/entities';
import { ConversationMembershipService } from './membership';
import { FriendshipAccessService } from './friendship-access.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, ConversationMember, Friendship])],
  providers: [ConversationMembershipService, FriendshipAccessService],
  exports: [ConversationMembershipService, FriendshipAccessService],
})
export class ConversationMembershipModule {}
