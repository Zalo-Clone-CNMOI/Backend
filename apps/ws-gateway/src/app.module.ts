import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RpcAllExceptionsFilter } from '@app/interceptors';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { WsAuthModule } from '@libs/auth';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { MediaClientModule } from '@app/clients/media-client';
import { ChatGateway } from './socket/chat.gateway';
import { ActiveStreamTracker } from './socket/active-stream.tracker';
import {
  ChatHandler,
  CallHandler,
  PresenceHandler,
  AiHandler,
  TypingHandler,
} from './socket/handlers';
import { CallRateLimiter } from './socket/handlers/call-rate-limiter';
import {
  ChatFanoutConsumer,
  PresenceFanoutConsumer,
  AuthFanoutConsumer,
  FriendFanoutConsumer,
  ConversationFanoutConsumer,
  CallFanoutConsumer,
  InteractionFanoutConsumer,
  AiFanoutConsumer,
  NotificationFanoutConsumer,
} from './transport/fanout';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    WsAuthModule,
    ConversationMembershipModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    KafkaModule,
    MediaClientModule.register({
      baseUrl: process.env.MEDIA_SERVICE_URL ?? 'http://media-service:3003',
    }),
  ],
  controllers: [
    ChatFanoutConsumer,
    PresenceFanoutConsumer,
    AuthFanoutConsumer,
    FriendFanoutConsumer,
    ConversationFanoutConsumer,
    CallFanoutConsumer,
    InteractionFanoutConsumer,
    AiFanoutConsumer,
    NotificationFanoutConsumer,
  ],
  providers: [
    { provide: APP_FILTER, useClass: RpcAllExceptionsFilter },
    ChatGateway,
    ActiveStreamTracker,
    ChatHandler,
    CallHandler,
    CallRateLimiter,
    PresenceHandler,
    AiHandler,
    TypingHandler,
  ],
})
export class AppModule {}
