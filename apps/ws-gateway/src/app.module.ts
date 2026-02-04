import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { AuthModule } from '@libs/auth';
import { DatabaseModule } from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { ChatGateway } from './socket/chat.gateway';
import { KafkaFanoutConsumer } from './transport/kafka-fanout.consumer';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    AuthModule,
    DatabaseModule,
    ConversationMembershipModule,
    KafkaModule,
  ],
  controllers: [KafkaFanoutConsumer],
  providers: [ChatGateway],
})
export class AppModule {}
