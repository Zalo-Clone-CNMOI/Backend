import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Friendship } from '@libs/database/entities';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { KafkaModule } from '@libs/kafka/kafka.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Friendship]), KafkaModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
