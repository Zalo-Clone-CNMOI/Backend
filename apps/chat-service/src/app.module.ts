import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { HealthCheckService } from '@libs/shared';
import { DatabaseModule, User, ConversationMember } from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { AiMessageConsumer } from './consumers/ai-message.consumer';
import { PersistMessageConsumer } from './consumers/persist-message.consumer';
import { PollMessageConsumer } from './consumers/poll-message.consumer';
import { SendMessageHandler } from './consumers/send-message.handler';
import { ModerationResultHandler } from './consumers/moderation-result.handler';
import { MessageConsumerSharedService } from './consumers/message-consumer-shared.service';
import { ChatPublisher } from './services/chat.publisher';
import { MessagesModule } from './modules/messages';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    TypeOrmModule.forFeature([User, ConversationMember]),
    KafkaModule,
    NotificationOutboxModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    ConversationMembershipModule,
    MessagesModule,
  ],
  controllers: [AiMessageConsumer, PersistMessageConsumer, PollMessageConsumer, HealthController],
  providers: [
    ChatPublisher,
    HealthCheckService,
    MessageConsumerSharedService,
    SendMessageHandler,
    ModerationResultHandler,
  ],
})
export class AppModule {}
