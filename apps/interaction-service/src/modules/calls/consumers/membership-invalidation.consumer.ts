import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { ClientKafka } from '@nestjs/microservices';
import {
  KafkaTopics,
  type ConversationMemberRemovedEvent,
  type CallLeaveCommand,
} from '@libs/contracts';
import { Public } from '@app/decorator';
import { KAFKA_CLIENT } from '@libs/kafka';
import { ConversationMembershipService } from '@libs/mvp-access';
import { CallStateStore } from '../utils/call-state.store';

@Controller()
@Public()
export class MembershipInvalidationConsumer {
  private readonly logger = new Logger(MembershipInvalidationConsumer.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly membershipService: ConversationMembershipService,
    private readonly stateStore: CallStateStore,
  ) {}

  @EventPattern(KafkaTopics.ConversationMemberRemoved)
  async onMemberRemoved(
    @Payload() event: ConversationMemberRemovedEvent,
  ): Promise<void> {
    this.membershipService.invalidate(
      event.removed_user_id,
      event.conversation_id,
    );

    const state = await this.stateStore.get(event.conversation_id);
    if (!state || state.status === 'ended') {
      return;
    }

    const status = state.participants[event.removed_user_id];
    if (!status || status === 'left' || status === 'rejected') {
      return;
    }

    this.logger.log(
      `Force-leaving removed user ${event.removed_user_id} from active call ${state.call_id}`,
    );

    const cmd: CallLeaveCommand = {
      call_id: state.call_id,
      conversation_id: event.conversation_id,
      user_id: event.removed_user_id,
      reason: 'removed_from_conversation',
      left_at: event.removed_at,
      trace_id: event.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallLeave, {
      key: event.conversation_id,
      value: cmd,
    });
  }
}
