import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { RedisModule } from '@libs/redis';
import { DatabaseModule } from '@libs/database';
import { MetricsModule } from '@libs/metrics';
import { ScyllaModule } from '@libs/scylla';
import { S3Module } from '@libs/s3';
import {
  AiModerationLog,
  AiUsageLog,
  DocumentMetadata,
  DocumentChunk,
  AiEntityDetectionLog,
} from '@libs/database/entities';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { SmartReplyModule } from './modules/smart-reply/smart-reply.module';
import { SummaryModule } from './modules/summary/summary.module';
import { TranslationModule } from './modules/translation/translation.module';
import { DocumentModule } from './modules/document/document.module';
import { EntityDetectionModule } from './modules/entity-detection/entity-detection.module';
import { CatchUpModule } from './modules/catch-up/catch-up.module';
import { ZaiChatModule } from './modules/zai-chat/zai-chat.module';
import { AiConsumer } from './transport/ai.consumer';
import { AiPublisher } from './transport/ai.publisher';
import { AiChatPublisher } from './transport/ai-chat.publisher';
import { HealthController } from './health.controller';
import { HealthCheckService } from '@libs/shared';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    TypeOrmModule.forFeature([
      AiModerationLog,
      AiUsageLog,
      DocumentMetadata,
      DocumentChunk,
      AiEntityDetectionLog,
    ]),
    KafkaModule,
    RedisModule.forRootAsync(),
    MetricsModule,
    ScyllaModule,
    S3Module.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        region: process.env.AWS_REGION ?? 'ap-southeast-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle:
          (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
        bucket: process.env.S3_BUCKET ?? '',
        uploadPrefix: process.env.S3_UPLOAD_PREFIX ?? 'uploads/',
        presignExpiresSeconds: Number(
          process.env.S3_PRESIGN_EXPIRES_SECONDS ?? 60,
        ),
      }),
    }),
    AiGatewayModule,
    ModerationModule,
    SmartReplyModule,
    SummaryModule,
    TranslationModule,
    DocumentModule,
    EntityDetectionModule,
    CatchUpModule,
    ZaiChatModule,
  ],
  controllers: [AiConsumer, HealthController],
  providers: [AiPublisher, AiChatPublisher, HealthCheckService],
  exports: [AiPublisher, AiChatPublisher],
})
export class AppModule {}
