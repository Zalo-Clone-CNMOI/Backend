import { Module } from '@nestjs/common';
import { ConfigModule, APP_CONFIG, AppConfig } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { RedisModule } from '@libs/redis';
import { DatabaseModule } from '@libs/database';
import { MetricsModule } from '@libs/metrics';
import { FirebaseModule } from '@libs/firebase';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DeviceToken,
  NotificationPreference,
  NotificationLog,
} from '@libs/database/entities';
import { NotificationConsumer } from './transport/notification.consumer';
import { NotificationPublisher } from './transport/notification.publisher';
import { NOTIFICATION_PROVIDER } from './providers/notification.provider';
import { FcmNotificationProvider } from './providers/fcm/fcm-notification.provider';
import { NotificationService } from './services/notification.service';
import { NotificationBatcher } from './services/notification.batcher';
import { NotificationQueue } from './services/notification.queue';
import { NotificationMetrics } from './services/notification.metrics';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    KafkaModule,
    RedisModule.forRootAsync(),
    DatabaseModule,
    TypeOrmModule.forFeature([
      DeviceToken,
      NotificationPreference,
      NotificationLog,
    ]),
    MetricsModule,
    FirebaseModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        projectId: config.firebaseProjectId ?? '',
        clientEmail: config.firebaseClientEmail ?? '',
        privateKey: config.firebasePrivateKey ?? '',
      }),
    }),
  ],
  controllers: [NotificationConsumer],
  providers: [
    NotificationPublisher,
    NotificationService,
    NotificationBatcher,
    NotificationQueue,
    NotificationMetrics,
    {
      provide: NOTIFICATION_PROVIDER,
      useClass: FcmNotificationProvider,
    },
  ],
})
export class AppModule {}
