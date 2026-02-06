import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { RedisModule } from '@libs/redis';
import { MetricsModule } from '@libs/metrics';
import { PresenceConsumer } from './consumers/presence.consumer';
import { PresencePublisher } from './services/presence.publisher';
import { PresenceStore } from './services/presence.store';
import { PresenceMetrics } from './services/presence.metrics';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    KafkaModule,
    RedisModule.forRootAsync(),
    MetricsModule,
  ],
  controllers: [PresenceConsumer],
  providers: [PresencePublisher, PresenceStore, PresenceMetrics],
})
export class AppModule {}
