import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationMember } from '@libs/database/entities';
import { ConversationMembershipService } from './membership';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationMember])],
  providers: [ConversationMembershipService],
  exports: [ConversationMembershipService],
})
export class ConversationMembershipModule {}
