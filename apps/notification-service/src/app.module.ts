import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { NotificationConsumer } from './transport/notification.consumer';
import { NotificationPublisher } from './transport/notification.publisher';
import { NotificationProvider } from './providers/notification.provider';
import { MockNotificationProvider } from './providers/mock/mock-notification.provider';
import { SentNotificationStore } from './providers/mock/sent-notification.store';

@Module({
  imports: [ConfigModule, LoggerModule, KafkaModule],
  controllers: [NotificationConsumer],
  providers: [
    NotificationPublisher,
    SentNotificationStore,
    {
      provide: NotificationProvider,
      useClass: MockNotificationProvider,
    },
  ],
})
export class AppModule {}
