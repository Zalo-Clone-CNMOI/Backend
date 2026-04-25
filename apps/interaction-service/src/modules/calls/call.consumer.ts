import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { ClientKafka } from '@nestjs/microservices';
import {
  KafkaTopics,
  type CallAcceptCommand,
  type CallAcceptedEvent,
  type CallEndCommand,
  type CallEndedEvent,
  type CallLeaveCommand,
  type CallLeftEvent,
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
import { CallTimeoutService } from './call-timeout.service';
import { uniqueParticipants } from './call-participants.util';

@Controller()
@Public()
export class CallConsumer {
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly membershipAccess: CallMembershipAccessService,
    private readonly stateStore: CallStateStore,
    private readonly eventsPublisher: CallEventsPublisher,
    private readonly callTimeoutService: CallTimeoutService,
  ) {}

  @EventPattern(KafkaTopics.CallStart)
  async onCallStart(@Payload() cmd: CallStartCommand): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.initiator_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.initiator_id,
        cmd.trace_id,
      );
      return;
    }

    const existing = await this.stateStore.get(cmd.conversation_id);
    if (existing && existing.status !== 'ended') {
      this.eventsPublisher.publishStateUpdate(cmd.conversation_id, existing, {
        requestedBy: cmd.initiator_id,
        reason: 'active_call_exists',
        traceId: cmd.trace_id,
      });
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
      conversation_type: cmd.conversation_type,
      call_type: cmd.call_type,
      status: 'ringing',
      initiator_id: cmd.initiator_id,
      participants,
      started_at: cmd.started_at,
      trace_id: cmd.trace_id,
    };

    await this.stateStore.set(cmd.conversation_id, state);
    await this.callTimeoutService.scheduleTimeout(cmd.call_id, cmd.conversation_id);

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
    this.eventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallSignalSend)
  async onCallSignal(@Payload() cmd: CallSignalCommand): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.sender_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.sender_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.eventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.sender_id,
        state ?? null,
        cmd.trace_id,
      );
      return;
    }

    if (cmd.target_user_id) {
      const targetStatus = state.participants[cmd.target_user_id];
      if (!targetStatus || targetStatus !== 'accepted') {
        this.eventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
          requestedBy: cmd.sender_id,
          reason: 'target_not_in_call',
          traceId: cmd.trace_id,
        });
        return;
      }
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
    const allowed = await this.membershipAccess.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.eventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state ?? null,
        cmd.trace_id,
      );
      return;
    }

    state.participants[cmd.user_id] = 'accepted';
    state.status = 'ongoing';
    state.trace_id = cmd.trace_id;

    await this.stateStore.set(cmd.conversation_id, state);

    const acceptedEvent: CallAcceptedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      accepted_at: cmd.accepted_at,
      trace_id: cmd.trace_id,
    };

    this.kafkaClient.emit(KafkaTopics.CallAccepted, acceptedEvent);
    this.eventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallReject)
  async onCallReject(@Payload() cmd: CallRejectCommand): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.eventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state ?? null,
        cmd.trace_id,
      );
      return;
    }

    state.participants[cmd.user_id] = 'rejected';
    state.trace_id = cmd.trace_id;

    const rejectedEvent: CallRejectedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      reason: cmd.reason,
      rejected_at: cmd.rejected_at,
      trace_id: cmd.trace_id,
    };
    this.kafkaClient.emit(KafkaTopics.CallRejected, rejectedEvent);

    // Direct call: auto-end when all non-initiator participants have rejected
    if (state.conversation_type === 'direct') {
      const pendingCount = Object.entries(state.participants).filter(
        ([uid, status]) =>
          uid !== state.initiator_id &&
          (status === 'invited' || status === 'accepted'),
      ).length;

      if (pendingCount === 0) {
        await this.terminateCall(
          state,
          state.initiator_id,
          cmd.rejected_at,
          'rejected',
          cmd.trace_id,
        );
        return;
      }
    }

    await this.stateStore.set(cmd.conversation_id, state);
    this.eventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallEnd)
  async onCallEnd(@Payload() cmd: CallEndCommand): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.eventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state ?? null,
        cmd.trace_id,
      );
      return;
    }

    // Group call: non-initiator calling "end" is treated as leaving
    if (
      state.conversation_type === 'group' &&
      cmd.user_id !== state.initiator_id
    ) {
      await this.performLeave(
        state,
        cmd.user_id,
        cmd.ended_at,
        cmd.reason,
        cmd.trace_id,
      );
      return;
    }

    // Direct call, or group call by initiator: terminate for all
    await this.terminateCall(
      state,
      cmd.user_id,
      cmd.ended_at,
      cmd.reason,
      cmd.trace_id,
    );
  }

  @EventPattern(KafkaTopics.CallLeave)
  async onCallLeave(@Payload() cmd: CallLeaveCommand): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.eventsPublisher.publishCallNotFoundUpdate(
        cmd.conversation_id,
        cmd.user_id,
        state ?? null,
        cmd.trace_id,
      );
      return;
    }

    await this.performLeave(
      state,
      cmd.user_id,
      cmd.left_at,
      cmd.reason,
      cmd.trace_id,
    );
  }

  @EventPattern(KafkaTopics.CallStateRequest)
  async onCallStateRequest(
    @Payload() cmd: CallStateRequestCommand,
  ): Promise<void> {
    const allowed = await this.membershipAccess.ensureMember(
      cmd.user_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.eventsPublisher.publishNotMemberUpdate(
        cmd.conversation_id,
        cmd.user_id,
        cmd.trace_id,
      );
      return;
    }

    const state = await this.stateStore.get(cmd.conversation_id);
    this.eventsPublisher.publishStateUpdate(cmd.conversation_id, state, {
      requestedBy: cmd.user_id,
      reason: state ? undefined : 'no_active_call',
      traceId: cmd.trace_id,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async performLeave(
    state: CallStateSnapshot,
    userId: string,
    leftAt: number,
    reason?: string,
    traceId?: string,
  ): Promise<void> {
    state.participants[userId] = 'left';
    state.trace_id = traceId;

    const activeCount = Object.values(state.participants).filter(
      (s) => s === 'accepted',
    ).length;

    if (activeCount === 0) {
      await this.terminateCall(state, userId, leftAt, 'all_left', traceId);
      return;
    }

    await this.stateStore.set(state.conversation_id, state);

    const leftEvent: CallLeftEvent = {
      call_id: state.call_id,
      conversation_id: state.conversation_id,
      user_id: userId,
      reason,
      left_at: leftAt,
      trace_id: traceId,
    };
    this.kafkaClient.emit(KafkaTopics.CallLeft, leftEvent);
    this.eventsPublisher.publishStateUpdate(state.conversation_id, state, {
      traceId,
    });
  }

  private async terminateCall(
    state: CallStateSnapshot,
    userId: string,
    endedAt: number,
    reason?: string,
    traceId?: string,
  ): Promise<void> {
    await this.callTimeoutService.cancelTimeout(state.call_id, state.conversation_id);
    state.status = 'ended';
    state.ended_at = endedAt;
    state.participants[userId] = 'left';
    state.trace_id = traceId;

    const endedEvent: CallEndedEvent = {
      call_id: state.call_id,
      conversation_id: state.conversation_id,
      user_id: userId,
      reason,
      ended_at: endedAt,
      trace_id: traceId,
    };

    this.kafkaClient.emit(KafkaTopics.CallEnded, endedEvent);
    await this.stateStore.clear(state.conversation_id);
    this.eventsPublisher.publishStateUpdate(state.conversation_id, null, {
      reason: reason ?? 'ended',
      traceId,
    });
  }
}
