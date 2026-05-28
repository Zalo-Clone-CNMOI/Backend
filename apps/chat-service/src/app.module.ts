import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, ConfigModule, type AppConfig } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { MetricsModule } from '@libs/metrics';
import { AiCoreClientModule } from '@app/clients';
import { HealthCheckService } from '@libs/shared';
import {
  DatabaseModule,
  User,
  ConversationMember,
  DocumentMetadata,
} from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { AiMessageConsumer } from './consumers/ai-message.consumer';
import { PersistMessageConsumer } from './consumers/persist-message.consumer';
import { PollMessageConsumer } from './consumers/poll-message.consumer';
import { SendMessageHandler } from './consumers/send-message.handler';
import { ModerationResultHandler } from './consumers/moderation-result.handler';
import { MessageConsumerSharedService } from './consumers/message-consumer-shared.service';
import { ChatPublisher } from './services/chat.publisher';
import { DocumentLinkService } from './services/document-link.service';
import { PreSendModerationMetricsService } from './services/pre-send-moderation.metrics';
import { PreSendModerationService } from './services/pre-send-moderation.service';
import { MessagesModule } from './modules/messages';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    TypeOrmModule.forFeature([User, ConversationMember, DocumentMetadata]),
    KafkaModule,
    NotificationOutboxModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    MetricsModule,
    AiCoreClientModule.registerAsync({
      // Use the project's @libs/config (APP_CONFIG) — chat-service does NOT set
      // up @nestjs/config, so injecting ConfigService here crashed boot.
      useFactory: (config: AppConfig) => ({
        baseUrl: config.aiCoreServiceUrl ?? 'http://ai-core-service:5005/api',
      }),
      inject: [APP_CONFIG],
    }),
    ConversationMembershipModule,
    MessagesModule,
  ],
  controllers: [
    AiMessageConsumer,
    PersistMessageConsumer,
    PollMessageConsumer,
    HealthController,
  ],
  providers: [
    ChatPublisher,
    DocumentLinkService,
    HealthCheckService,
    MessageConsumerSharedService,
    SendMessageHandler,
    ModerationResultHandler,
    PreSendModerationMetricsService,
    PreSendModerationService,
  ],
})
export class AppModule {}
