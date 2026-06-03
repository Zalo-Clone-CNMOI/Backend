import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Friendship } from '@libs/database/entities';
import { FriendsController } from './friends.controller';
import { InternalFriendsController } from './internal-friends.controller';
import { FriendsService } from './friends.service';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Friendship]),
    KafkaModule,
    NotificationOutboxModule,
  ],
  controllers: [FriendsController, InternalFriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
