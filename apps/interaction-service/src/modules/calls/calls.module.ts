import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallSession } from '@libs/database/entities';
import { CallStateStore } from './utils/call-state.store';
import { CallEventsPublisher } from './services/call-events.publisher';
import { CallMembershipAccessService } from './services/call-membership-access.service';
import { IceServerService } from './services/ice-server.service';
import { IceServerController } from './ice-server.controller';
import { CallTimeoutService } from './services/call-timeout.service';
import { CallTimeoutScheduler } from './services/call-timeout.scheduler';
import { CallHistoryService } from './services/call-history.service';
import { CallHistoryController } from './call-history.controller';
import { CallConsumer } from './consumers/call.consumer';

@Module({
  imports: [
    KafkaModule,
    NotificationOutboxModule,
    ConversationMembershipModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([CallSession]),
  ],
  controllers: [CallConsumer, IceServerController, CallHistoryController],
  providers: [
    CallStateStore,
    CallEventsPublisher,
    CallMembershipAccessService,
    IceServerService,
    CallTimeoutService,
    CallTimeoutScheduler,
    CallHistoryService,
  ],
})
export class CallsModule {}
