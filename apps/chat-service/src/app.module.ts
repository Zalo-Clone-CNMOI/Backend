import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { MetricsModule } from '@libs/metrics';
import { AiCoreClientModule } from '@app/clients';
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
import { PreSendModerationMetricsService } from './services/pre-send-moderation.metrics';
import { PreSendModerationService } from './services/pre-send-moderation.service';
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
    MetricsModule,
    AiCoreClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('AI_CORE_SERVICE_URL') ??
          'http://ai-core-service:5005/api',
      }),
      inject: [ConfigService],
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
    HealthCheckService,
    MessageConsumerSharedService,
    SendMessageHandler,
    ModerationResultHandler,
    PreSendModerationMetricsService,
    PreSendModerationService,
  ],
})
export class AppModule {}
