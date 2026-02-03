import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { PersistMessageConsumer } from './consumers/persist-message.consumer';
import { ChatPublisher } from './services/chat.publisher';
import { MessagesModule } from './modules/messages';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    KafkaModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    MessagesModule,
  ],
  controllers: [PersistMessageConsumer],
  providers: [ChatPublisher],
})
export class AppModule {}
