import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { ClientKafka } from '@nestjs/microservices';
import {
  KafkaTopics,
  type CallAcceptCommand,
  type CallAcceptedEvent,
  type CallEndCommand,
  type CallEndedEvent,
  type CallParticipantStatus,
  type CallRejectCommand,
  type CallRejectedEvent,
  type CallSignalCommand,
  type CallSignalForwardedEvent,
  type CallStartCommand,
  type CallStartedEvent,
  type CallStateRequestCommand,
  type CallStateSnapshot,
} from '@libs/contracts';
import { Public } from '@app/decorator';
import { KAFKA_CLIENT } from '@libs/kafka';
import { CallStateStore } from './call-state.store';
import { CallEventsPublisher } from './call-events.publisher';
import { CallMembershipAccessService } from './call-membership-access.service';
import { uniqueParticipants } from './call-participants.util';
@Controller()
@Public()
export class CallConsumer {
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly callMembershipAccessService: CallMembershipAccessService,
    private readonly callStateStore: CallStateStore,
    private readonly callEventsPublisher: CallEventsPublisher,
  ) {}

  @EventPattern(KafkaTopics.CallStart)
  async onCallStart(@Payload() cmd: CallStartCommand): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.initiator_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.initiator_id,
        cmd.trace_id,
      );
      return;
    }
    const existing = await this.callStateStore.get(cmd.conversation_id);
    if (existing && existing.status !== 'ended') {
      this.callEventsPublisher.publishStateUpdate(
        cmd.conversation_id,
        existing,
        {
          requestedBy: cmd.initiator_id,
          reason: 'active_call_exists',
          traceId: cmd.trace_id,
        },
      );
      return;
    }
    const participantIds = uniqueParticipants(
      cmd.initiator_id,
      cmd.participant_ids,
    );
    const participants: Record<string, CallParticipantStatus> = {};
    for (const participantId of participantIds) {
      participants[participantId] =
        participantId === cmd.initiator_id ? 'accepted' : 'invited';
    }

    const state: CallStateSnapshot = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      call_type: cmd.call_type,
      status: 'ringing',
      initiator_id: cmd.initiator_id,
      participants,
      started_at: cmd.started_at,
      trace_id: cmd.trace_id,
    };
    await this.callStateStore.set(cmd.conversation_id, state);
    const startedEvent: CallStartedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      initiator_id: cmd.initiator_id,
      call_type: cmd.call_type,
      participant_ids: participantIds,
      started_at: cmd.started_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallStarted, startedEvent);
    this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallSignalSend)
  async onCallSignal(@Payload() cmd: CallSignalCommand): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.sender_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.sender_id,
        cmd.trace_id,
      );
      return;
    }
    const state = await this.callStateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.callEventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.sender_id,
        state,
        cmd.trace_id,
      );
      return;
    }
    if (cmd.target_user_id && !state.participants[cmd.target_user_id]) {
      this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
        requestedBy: cmd.sender_id,
        reason: 'target_not_in_call',
        traceId: cmd.trace_id,
      });
      return;
    }
    const event: CallSignalForwardedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      sender_id: cmd.sender_id,
      target_user_id: cmd.target_user_id,
      signal_type: cmd.signal_type,
      sdp: cmd.sdp,
      candidate: cmd.candidate,
      sdp_mid: cmd.sdp_mid,
      sdp_mline_index: cmd.sdp_mline_index,
      sent_at: cmd.sent_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallSignalForwarded, event);
  }

  @EventPattern(KafkaTopics.CallAccept)
  async onCallAccept(@Payload() cmd: CallAcceptCommand): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }
    const state = await this.callStateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.callEventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state,
        cmd.trace_id,
      );
      return;
    }
    state.participants[cmd.user_id] = 'accepted';
    state.status = 'ongoing';
    state.trace_id = cmd.trace_id;
    await this.callStateStore.set(cmd.conversation_id, state);
    const acceptedEvent: CallAcceptedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      accepted_at: cmd.accepted_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallAccepted, acceptedEvent);
    this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallReject)
  async onCallReject(@Payload() cmd: CallRejectCommand): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }
    const state = await this.callStateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.callEventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state,
        cmd.trace_id,
      );
      return;
    }
    state.participants[cmd.user_id] = 'rejected';
    state.trace_id = cmd.trace_id;
    await this.callStateStore.set(cmd.conversation_id, state);
    const rejectedEvent: CallRejectedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      reason: cmd.reason,
      rejected_at: cmd.rejected_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallRejected, rejectedEvent);
    this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallEnd)
  async onCallEnd(@Payload() cmd: CallEndCommand): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }
    const state = await this.callStateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.callEventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state,
        cmd.trace_id,
      );
      return;
    }
    state.status = 'ended';
    state.ended_at = cmd.ended_at;
    state.participants[cmd.user_id] = 'left';
    state.trace_id = cmd.trace_id;

    const endedEvent: CallEndedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      reason: cmd.reason,
      ended_at: cmd.ended_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallEnded, endedEvent);
    await this.callStateStore.clear(cmd.conversation_id);
    this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, null, {
      reason: cmd.reason ?? 'ended',
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallStateRequest)
  async onCallStateRequest(
    @Payload() cmd: CallStateRequestCommand,
  ): Promise<void> {
    const allowed = await this.callMembershipAccessService.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.callEventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }
    const state = await this.callStateStore.get(cmd.conversation_id);
    this.callEventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      requestedBy: cmd.user_id,
      reason: state ? undefined : 'no_active_call',
      traceId: cmd.trace_id,
    });
  }
}
