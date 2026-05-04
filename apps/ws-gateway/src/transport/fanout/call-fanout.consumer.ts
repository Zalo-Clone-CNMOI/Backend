import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type CallAcceptedEvent,
  type CallEndedEvent,
  type CallLeftEvent,
  type CallRejectedEvent,
  type CallSignalForwardedEvent,
  type CallStartedEvent,
  type CallStateUpdatedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class CallFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  @EventPattern(KafkaTopics.CallStarted)
  onCallStarted(@Payload() payload: CallStartedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallStarted,
      {
        call_id: payload.call_id,
        conversation_id: payload.conversation_id,
        conversation_type: payload.conversation_type,
        initiator_id: payload.initiator_id,
        call_type: payload.call_type,
        participant_ids: payload.participant_ids,
        started_at: payload.started_at,
      },
    );
  }

  @EventPattern(KafkaTopics.CallSignalForwarded)
  onCallSignal(@Payload() payload: CallSignalForwardedEvent) {
    const out = {
      call_id: payload.call_id,
      conversation_id: payload.conversation_id,
      sender_id: payload.sender_id,
      target_user_id: payload.target_user_id,
      signal_type: payload.signal_type,
      sdp: payload.sdp,
      candidate: payload.candidate,
      sdp_mid: payload.sdp_mid,
      sdp_mline_index: payload.sdp_mline_index,
      sent_at: payload.sent_at,
      state_version: payload.state_version,
    };

    if (payload.target_user_id) {
      this.gateway.emitToUser(
        payload.target_user_id,
        WsEvents.CallSignalReceived,
        out,
      );
      return;
    }

    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallSignalReceived,
      out,
    );
  }

  @EventPattern(KafkaTopics.CallAccepted)
  onCallAccepted(@Payload() payload: CallAcceptedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallAccepted,
      {
        call_id: payload.call_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        accepted_at: payload.accepted_at,
        participants: payload.participants,
        status: payload.status,
        state_version: payload.state_version,
      },
    );
  }

  @EventPattern(KafkaTopics.CallRejected)
  onCallRejected(@Payload() payload: CallRejectedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallRejected,
      {
        call_id: payload.call_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reason: payload.reason,
        rejected_at: payload.rejected_at,
      },
    );
  }

  @EventPattern(KafkaTopics.CallEnded)
  onCallEnded(@Payload() payload: CallEndedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallEnded,
      {
        call_id: payload.call_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reason: payload.reason,
        ended_at: payload.ended_at,
      },
    );
  }

  @EventPattern(KafkaTopics.CallLeft)
  onCallLeft(@Payload() payload: CallLeftEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallLeft,
      {
        call_id: payload.call_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reason: payload.reason,
        left_at: payload.left_at,
      },
    );
  }

  @EventPattern(KafkaTopics.CallStateUpdated)
  onCallStateUpdated(@Payload() payload: CallStateUpdatedEvent) {
    if (payload.requested_by) {
      this.gateway.emitToUser(
        payload.requested_by,
        WsEvents.CallStateUpdated,
        payload,
      );
      return;
    }

    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.CallStateUpdated,
      payload,
    );
  }
}
