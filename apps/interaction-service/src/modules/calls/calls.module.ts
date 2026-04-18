import { Module } from '@nestjs/common';
import { KafkaModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallConsumer } from './call.consumer';

@Module({
  imports: [KafkaModule, ConversationMembershipModule],
  controllers: [CallConsumer],
})
export class CallsModule {}
