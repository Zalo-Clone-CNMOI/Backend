import { Module } from '@nestjs/common';
import { KafkaModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallConsumer } from './call.consumer';
import { CallStateStore } from './call-state.store';
import { CallEventsPublisher } from './call-events.publisher';
import { CallMembershipAccessService } from './call-membership-access.service';

@Module({
  imports: [KafkaModule, ConversationMembershipModule],
  controllers: [CallConsumer],
  providers: [CallStateStore, CallEventsPublisher, CallMembershipAccessService],
})
export class CallsModule {}
