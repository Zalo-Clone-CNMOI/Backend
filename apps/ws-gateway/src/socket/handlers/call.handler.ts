import { Injectable, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { ConversationMembershipService } from '@libs/mvp-access';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  KafkaTopics,
  WsEvents,
  type CallAcceptCommand,
  type CallEndCommand,
  type CallRejectCommand,
  type CallSignalCommand,
  type CallStartCommand,
  type CallStateRequestCommand,
  type WsCallAcceptPayload,
  type WsCallEndPayload,
  type WsCallRejectPayload,
  type WsCallSignalPayload,
  type WsCallStartPayload,
  type WsCallStateRequestPayload,
  type WsErrorPayload,
} from '@libs/contracts';
import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

@Injectable()
export class CallHandler {
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  async handleStart(socket: AuthedSocket, body: WsCallStartPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallStartCommand = {
      call_id: body.call_id,
      conversation_id: body.conversation_id,
      initiator_id: userId,
      call_type: body.call_type,
      participant_ids: body.participant_ids,
      started_at: body.started_at,
      trace_id: `ws:${socket.id}:${body.call_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallStart, cmd);
  }

  async handleSignal(socket: AuthedSocket, body: WsCallSignalPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallSignalCommand = {
      call_id: body.call_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      target_user_id: body.target_user_id,
      signal_type: body.signal_type,
      sdp: body.sdp,
      candidate: body.candidate,
      sdp_mid: body.sdp_mid,
      sdp_mline_index: body.sdp_mline_index,
      sent_at: body.sent_at,
      trace_id: `ws:${socket.id}:${body.call_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallSignalSend, cmd);
  }

  async handleAccept(socket: AuthedSocket, body: WsCallAcceptPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallAcceptCommand = {
      call_id: body.call_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      accepted_at: body.accepted_at,
      trace_id: `ws:${socket.id}:${body.call_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallAccept, cmd);
  }

  async handleReject(socket: AuthedSocket, body: WsCallRejectPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallRejectCommand = {
      call_id: body.call_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      reason: body.reason,
      rejected_at: body.rejected_at,
      trace_id: `ws:${socket.id}:${body.call_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallReject, cmd);
  }

  async handleEnd(socket: AuthedSocket, body: WsCallEndPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallEndCommand = {
      call_id: body.call_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      reason: body.reason,
      ended_at: body.ended_at,
      trace_id: `ws:${socket.id}:${body.call_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallEnd, cmd);
  }

  async handleStateRequest(
    socket: AuthedSocket,
    body: WsCallStateRequestPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      this.emitForbidden(socket, body.conversation_id);
      return;
    }

    const cmd: CallStateRequestCommand = {
      conversation_id: body.conversation_id,
      user_id: userId,
      requested_at: body.requested_at,
      trace_id: `ws:${socket.id}:state:${body.conversation_id}`,
    };

    void this.kafka.emit(KafkaTopics.CallStateRequest, cmd);
  }

  private emitForbidden(socket: AuthedSocket, conversationId: string) {
    socket.emit(WsEvents.WsError, {
      code: 'FORBIDDEN',
      message: 'not_member',
      details: { conversation_id: conversationId },
      timestamp: new Date().toISOString(),
    } satisfies WsErrorPayload);
  }
}
