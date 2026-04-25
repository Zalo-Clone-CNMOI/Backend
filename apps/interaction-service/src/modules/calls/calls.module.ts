import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { KafkaModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CallSession } from '@libs/database/entities';
import { CallConsumer } from './call.consumer';
import { CallStateStore } from './call-state.store';
import { CallEventsPublisher } from './call-events.publisher';
import { CallMembershipAccessService } from './call-membership-access.service';
import { IceServerService } from './ice-server.service';
import { IceServerController } from './ice-server.controller';
import { CallTimeoutService } from './call-timeout.service';
import { CallTimeoutScheduler } from './call-timeout.scheduler';
import { CallHistoryService } from './call-history.service';
import { CallHistoryController } from './call-history.controller';

@Module({
  imports: [
    KafkaModule,
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
