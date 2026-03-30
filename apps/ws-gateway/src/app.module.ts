import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { AuthModule } from '@libs/auth';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule, MediaFile } from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { ChatGateway } from './socket/chat.gateway';
import {
  ChatHandler,
  PresenceHandler,
  AiHandler,
  TypingHandler,
} from './socket/handlers';
import {
  ChatFanoutConsumer,
  PresenceFanoutConsumer,
  AuthFanoutConsumer,
  FriendFanoutConsumer,
  AiFanoutConsumer,
  NotificationFanoutConsumer,
} from './transport/fanout';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    AuthModule,
    DatabaseModule,
    TypeOrmModule.forFeature([MediaFile]),
    ConversationMembershipModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    KafkaModule,
  ],
  controllers: [
    ChatFanoutConsumer,
    PresenceFanoutConsumer,
    AuthFanoutConsumer,
    FriendFanoutConsumer,
    AiFanoutConsumer,
    NotificationFanoutConsumer,
  ],
  providers: [
    ChatGateway,
    ChatHandler,
    PresenceHandler,
    AiHandler,
    TypingHandler,
  ],
})
export class AppModule {}
