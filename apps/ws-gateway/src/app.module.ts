import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RpcAllExceptionsFilter } from '@app/interceptors';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { WsAuthModule } from '@libs/auth';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { MediaClientModule } from '@app/clients/media-client';
import { MembershipClientModule } from '@app/clients/membership-client';
import { WsMembershipModule } from './access/ws-membership.module';
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
    ScyllaModule,
    RedisModule.forRootAsync(),
    KafkaModule,
    MediaClientModule.register({
      baseUrl: process.env.MEDIA_SERVICE_URL ?? 'http://media-service:3003/api',
    }),
    MembershipClientModule.register({
      baseUrl:
        process.env.INTERACTION_SERVICE_URL ??
        'http://interaction-service:5004/api',
    }),
    WsMembershipModule,
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
