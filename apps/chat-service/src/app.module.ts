import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { RedisModule } from '@libs/redis';
import { DatabaseModule, User, ConversationMember } from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { PersistMessageConsumer } from './consumers/persist-message.consumer';
import { ChatPublisher } from './services/chat.publisher';
import { MessagesModule } from './modules/messages';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    TypeOrmModule.forFeature([User, ConversationMember]),
    KafkaModule,
    ScyllaModule,
    RedisModule.forRootAsync(),
    ConversationMembershipModule,
    MessagesModule,
  ],
  controllers: [PersistMessageConsumer],
  providers: [ChatPublisher],
})
export class AppModule {}
