import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { PresenceConsumer } from './consumers/presence.consumer';
import { PresencePublisher } from './services/presence.publisher';
import { PresenceStore } from './services/presence.store';

@Module({
  imports: [ConfigModule, LoggerModule, KafkaModule],
  controllers: [PresenceConsumer],
  providers: [PresencePublisher, PresenceStore],
})
export class AppModule {}
