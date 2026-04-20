import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutbox } from '@libs/database/entities';
import { KafkaModule } from '../kafka.module';
import { NotificationOutboxPublisher } from './notification-outbox.publisher';

@Module({
  imports: [KafkaModule, TypeOrmModule.forFeature([NotificationOutbox])],
  providers: [NotificationOutboxPublisher],
  exports: [NotificationOutboxPublisher],
})
export class NotificationOutboxModule {}
