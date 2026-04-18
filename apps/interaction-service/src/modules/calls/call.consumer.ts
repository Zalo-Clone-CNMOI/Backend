import { Controller, Inject, Logger } from '@nestjs/common';
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
  type CallStateUpdatedEvent,
} from '@libs/contracts';
import { ConversationMembershipService } from '@libs/mvp-access';
import { Public } from '@app/decorator';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { RedisClientType } from 'redis';
import { KAFKA_CLIENT } from '@libs/kafka';

@Controller()
@Public()
export class CallConsumer {
  private readonly logger = new Logger(CallConsumer.name);
  private readonly callStateTtlSeconds = 6 * 60 * 60;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  @EventPattern(KafkaTopics.CallStart)
  async onCallStart(@Payload() cmd: CallStartCommand): Promise<void> {
    const allowed = await this.ensureMember(
      cmd.initiator_id,
      cmd.conversation_id,
    );
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.initiator_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const existing = await this.getCallState(cmd.conversation_id);
    if (existing && existing.status !== 'ended') {
      this.publishStateUpdate(cmd.conversation_id, existing, {
        requestedBy: cmd.initiator_id,
        reason: 'active_call_exists',
        traceId: cmd.trace_id,
      });
      return;
    }

    const participantIds = this.uniqueParticipants(
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

    await this.setCallState(cmd.conversation_id, state);

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
    this.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallSignalSend)
  async onCallSignal(@Payload() cmd: CallSignalCommand): Promise<void> {
    const allowed = await this.ensureMember(cmd.sender_id, cmd.conversation_id);
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.sender_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const state = await this.getCallState(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.publishStateUpdate(cmd.conversation_id, state ?? null, {
        requestedBy: cmd.sender_id,
        reason: 'call_not_found',
        traceId: cmd.trace_id,
      });
      return;
    }

    if (cmd.target_user_id && !state.participants[cmd.target_user_id]) {
      this.publishStateUpdate(cmd.conversation_id, state, {
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
    const allowed = await this.ensureMember(cmd.user_id, cmd.conversation_id);
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.user_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const state = await this.getCallState(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.publishStateUpdate(cmd.conversation_id, state ?? null, {
        requestedBy: cmd.user_id,
        reason: 'call_not_found',
        traceId: cmd.trace_id,
      });
      return;
    }

    state.participants[cmd.user_id] = 'accepted';
    state.status = 'ongoing';
    state.trace_id = cmd.trace_id;

    await this.setCallState(cmd.conversation_id, state);

    const acceptedEvent: CallAcceptedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      accepted_at: cmd.accepted_at,
      trace_id: cmd.trace_id,
    };

    this.kafkaClient.emit(KafkaTopics.CallAccepted, acceptedEvent);
    this.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallReject)
  async onCallReject(@Payload() cmd: CallRejectCommand): Promise<void> {
    const allowed = await this.ensureMember(cmd.user_id, cmd.conversation_id);
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.user_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const state = await this.getCallState(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.publishStateUpdate(cmd.conversation_id, state ?? null, {
        requestedBy: cmd.user_id,
        reason: 'call_not_found',
        traceId: cmd.trace_id,
      });
      return;
    }

    state.participants[cmd.user_id] = 'rejected';
    state.trace_id = cmd.trace_id;

    await this.setCallState(cmd.conversation_id, state);

    const rejectedEvent: CallRejectedEvent = {
      call_id: cmd.call_id,
      conversation_id: cmd.conversation_id,
      user_id: cmd.user_id,
      reason: cmd.reason,
      rejected_at: cmd.rejected_at,
      trace_id: cmd.trace_id,
    };

    this.kafkaClient.emit(KafkaTopics.CallRejected, rejectedEvent);
    this.publishStateUpdate(cmd.conversation_id, state, {
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallEnd)
  async onCallEnd(@Payload() cmd: CallEndCommand): Promise<void> {
    const allowed = await this.ensureMember(cmd.user_id, cmd.conversation_id);
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.user_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const state = await this.getCallState(cmd.conversation_id);
    if (!state || state.call_id !== cmd.call_id || state.status === 'ended') {
      this.publishStateUpdate(cmd.conversation_id, state ?? null, {
        requestedBy: cmd.user_id,
        reason: 'call_not_found',
        traceId: cmd.trace_id,
      });
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

    await this.clearCallState(cmd.conversation_id);
    this.publishStateUpdate(cmd.conversation_id, null, {
      reason: cmd.reason ?? 'ended',
      traceId: cmd.trace_id,
    });
  }

  @EventPattern(KafkaTopics.CallStateRequest)
  async onCallStateRequest(
    @Payload() cmd: CallStateRequestCommand,
  ): Promise<void> {
    const allowed = await this.ensureMember(cmd.user_id, cmd.conversation_id);
    if (!allowed) {
      this.publishStateUpdate(cmd.conversation_id, null, {
        requestedBy: cmd.user_id,
        reason: 'not_member',
        traceId: cmd.trace_id,
      });
      return;
    }

    const state = await this.getCallState(cmd.conversation_id);
    this.publishStateUpdate(cmd.conversation_id, state, {
      requestedBy: cmd.user_id,
      reason: state ? undefined : 'no_active_call',
      traceId: cmd.trace_id,
    });
  }

  private async ensureMember(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      return await this.membershipService.canUserAccessConversation(
        userId,
        conversationId,
      );
    } catch (error) {
      this.logger.error(
        `Failed membership check for user=${userId}, conversation=${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  private uniqueParticipants(
    initiatorId: string,
    participantIds?: string[],
  ): string[] {
    const ids = new Set<string>([initiatorId]);
    for (const participantId of participantIds ?? []) {
      if (participantId && participantId.trim() !== '') {
        ids.add(participantId);
      }
    }
    return Array.from(ids);
  }

  private getCallStateKey(conversationId: string): string {
    return `call:state:conversation:${conversationId}`;
  }

  private async getCallState(
    conversationId: string,
  ): Promise<CallStateSnapshot | null> {
    const raw = await this.redis.get(this.getCallStateKey(conversationId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CallStateSnapshot;
    } catch (error) {
      this.logger.warn(
        `Invalid call state cache for conversation=${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.clearCallState(conversationId);
      return null;
    }
  }

  private async setCallState(
    conversationId: string,
    state: CallStateSnapshot,
  ): Promise<void> {
    await this.redis.setEx(
      this.getCallStateKey(conversationId),
      this.callStateTtlSeconds,
      JSON.stringify(state),
    );
  }

  private async clearCallState(conversationId: string): Promise<void> {
    await this.redis.del(this.getCallStateKey(conversationId));
  }

  private publishStateUpdate(
    conversationId: string,
    state: CallStateSnapshot | null,
    options?: {
      requestedBy?: string;
      reason?: string;
      traceId?: string;
    },
  ): void {
    const event: CallStateUpdatedEvent = {
      conversation_id: conversationId,
      state,
      requested_by: options?.requestedBy,
      updated_at: Date.now(),
      reason: options?.reason,
      trace_id: options?.traceId,
    };

    this.kafkaClient.emit(KafkaTopics.CallStateUpdated, event);
  }
}
