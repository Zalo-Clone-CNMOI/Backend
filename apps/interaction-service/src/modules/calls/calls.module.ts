import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { KafkaModule, NotificationOutboxModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallSession } from '@libs/database/entities';
import { CallStateStore } from './utils/call-state.store';
import { CallStateLock } from './utils/call-state.lock';
import { CallEventsPublisher } from './services/call-events.publisher';
import { CallMembershipAccessService } from './services/call-membership-access.service';
import { IceServerService } from './services/ice-server.service';
import { IceServerController } from './ice-server.controller';
import { CallTimeoutService } from './services/call-timeout.service';
import { CallTimeoutScheduler } from './services/call-timeout.scheduler';
import { CallHistoryService } from './services/call-history.service';
import { CallRecoveryService } from './services/call-recovery.service';
import { CallSystemMessageEmitter } from './services/call-system-message.emitter';
import { CallHistoryController } from './call-history.controller';
import { CallConsumer } from './consumers/call.consumer';
import { MembershipInvalidationConsumer } from './consumers/membership-invalidation.consumer';

@Module({
  imports: [
    KafkaModule,
    NotificationOutboxModule,
    ConversationMembershipModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([CallSession]),
  ],
  controllers: [
    CallConsumer,
    MembershipInvalidationConsumer,
    IceServerController,
    CallHistoryController,
  ],
  providers: [
    CallStateStore,
    CallStateLock,
    CallEventsPublisher,
    CallMembershipAccessService,
    IceServerService,
    CallTimeoutService,
    CallTimeoutScheduler,
    CallHistoryService,
    CallRecoveryService,
    CallSystemMessageEmitter,
  ],
})
export class CallsModule {}
