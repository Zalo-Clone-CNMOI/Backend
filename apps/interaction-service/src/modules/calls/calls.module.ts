import { Module } from '@nestjs/common';
import { KafkaModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallConsumer } from './call.consumer';
import { CallStateStore } from './call-state.store';
import { CallEventsPublisher } from './call-events.publisher';
import { CallMembershipAccessService } from './call-membership-access.service';
import { IceServerService } from './ice-server.service';
import { IceServerController } from './ice-server.controller';

@Module({
  imports: [KafkaModule, ConversationMembershipModule],
  controllers: [CallConsumer, IceServerController],
  providers: [
    CallStateStore,
    CallEventsPublisher,
    CallMembershipAccessService,
    IceServerService,
  ],
})
export class CallsModule {}
