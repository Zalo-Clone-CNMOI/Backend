import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type PresenceUpdatedEvent,
  type AuthQrConfirmedEvent,
  type AuthQrRejectedEvent,
  type FriendRequestSentEvent,
  type FriendRequestRespondedEvent,
  type FriendRequestCancelledEvent,
  type FriendRemovedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../socket/chat.gateway';

@Controller()
export class KafkaFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  @EventPattern(KafkaTopics.ChatMessageCreated)
  onMessageCreated(@Payload() payload: ChatMessageCreatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessage,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.created_at,
      },
    );
  }

  @EventPattern(KafkaTopics.PresenceUpdated)
  onPresenceUpdated(@Payload() payload: PresenceUpdatedEvent) {
    // MVP: broadcast presence to all connected sockets
    this.gateway.broadcastToAll(WsEvents.PresenceUpdate, payload);
  }

  /**
   * Handle QR login confirmed event
   * Emit tokens to specific PC socket
   */
  @EventPattern(KafkaTopics.AuthQrConfirmed)
  onQrConfirmed(@Payload() payload: AuthQrConfirmedEvent) {
    this.gateway.emitToSocket(payload.socketId, WsEvents.QrConfirmed, {
      sessionId: payload.sessionId,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expiresIn,
      user: payload.user,
    });
  }

  /**
   * Handle QR login rejected event
   * Notify PC socket about rejection
   */
  @EventPattern(KafkaTopics.AuthQrRejected)
  onQrRejected(@Payload() payload: AuthQrRejectedEvent) {
    this.gateway.emitToSocket(payload.socketId, WsEvents.QrRejected, {
      sessionId: payload.sessionId,
      reason: payload.reason,
    });
  }

  /**
   * Handle Send Friend Request event
   * Notify target user about new friend request
   */
  @EventPattern(KafkaTopics.SendFriendRequest)
  onSendFriendRequest(@Payload() payload: FriendRequestSentEvent) {
    this.gateway.emitToSocket(payload.addresseeId, WsEvents.SendFriendRequest, {
      requestId: payload.requestId,
      requester: payload.requester as unknown,
    });
  }

  /**
   * Handle Respond Friend Request event
   * Notify requester about the response to their friend request
   */
  @EventPattern(KafkaTopics.RespondFriendRequest)
  onRespondFriendRequest(@Payload() payload: FriendRequestRespondedEvent) {
    this.gateway.emitToSocket(
      payload.requesterId,
      WsEvents.RespondFriendRequest,
      {
        requestId: payload.requestId,
        status: payload.status,
        addressee: payload.addressee,
      },
    );
  }

  /**
   * Handle Cancel Friend Request event
   * Notify addressee that the friend request was cancelled
   */
  @EventPattern(KafkaTopics.CancelFriendRequest)
  onCancelFriendRequest(@Payload() payload: FriendRequestCancelledEvent) {
    this.gateway.emitToSocket(
      payload.addresseeId,
      WsEvents.CancelFriendRequest,
      {
        requestId: payload.requestId,
        requesterId: payload.requesterId,
      },
    );
  }

  /**
   * Handle Friend Removed event
   * Notify the other user that friendship was removed
   */
  @EventPattern(KafkaTopics.FriendRemoved)
  onFriendRemoved(@Payload() payload: FriendRemovedEvent) {
    this.gateway.emitToSocket(payload.friendId, WsEvents.FriendRemoved, {
      userId: payload.userId,
    });
  }
}
