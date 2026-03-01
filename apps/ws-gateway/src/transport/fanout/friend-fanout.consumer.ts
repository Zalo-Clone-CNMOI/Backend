import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type FriendRequestSentEvent,
  type FriendRequestRespondedEvent,
  type FriendRequestCancelledEvent,
  type FriendRemovedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class FriendFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Handle Send Friend Request event
   * Notify target user about new friend request
   */
  @EventPattern(KafkaTopics.SendFriendRequest)
  onSendFriendRequest(@Payload() payload: FriendRequestSentEvent) {
    void this.gateway.emitToSocket(
      payload.addresseeId,
      WsEvents.SendFriendRequest,
      {
        requestId: payload.requestId,
        requester: payload.requester as unknown,
      },
    );
  }

  /**
   * Handle Respond Friend Request event
   * Notify requester about the response to their friend request
   */
  @EventPattern(KafkaTopics.RespondFriendRequest)
  onRespondFriendRequest(@Payload() payload: FriendRequestRespondedEvent) {
    void this.gateway.emitToSocket(
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
    void this.gateway.emitToSocket(
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
    void this.gateway.emitToSocket(payload.friendId, WsEvents.FriendRemoved, {
      userId: payload.userId,
    });
  }
}
