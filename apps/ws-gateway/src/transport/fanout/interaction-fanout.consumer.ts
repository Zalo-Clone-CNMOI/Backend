import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ConversationCreatedEvent,
  type ConversationUpdatedEvent,
  type ConversationDisbandedEvent,
  type ConversationMemberAddedEvent,
  type ConversationMemberRemovedEvent,
  type ConversationMemberRoleUpdatedEvent,
  type GroupInviteSentEvent,
  type GroupInviteAcceptedEvent,
  type GroupInviteRejectedEvent,
  type GroupInviteCancelledEvent,
  type GroupInviteExpiredEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class InteractionFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  @EventPattern(KafkaTopics.ConversationCreated)
  onConversationCreated(@Payload() payload: ConversationCreatedEvent) {
    for (const member of payload.members) {
      void this.gateway.emitToUser(
        member.user_id,
        WsEvents.ConversationCreated,
        {
          conversation_id: payload.conversation_id,
          type: payload.type,
          name: payload.name,
          avatar_url: payload.avatar_url,
          created_by: payload.created_by,
          members: payload.members,
          created_at: payload.created_at,
        },
      );
    }
  }

  @EventPattern(KafkaTopics.ConversationUpdated)
  onConversationUpdated(@Payload() payload: ConversationUpdatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationUpdated,
      {
        conversation_id: payload.conversation_id,
        updated_by: payload.updated_by,
        name: payload.name,
        avatar_url: payload.avatar_url,
        updated_at: payload.updated_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationDisbanded)
  onConversationDisbanded(@Payload() payload: ConversationDisbandedEvent) {
    for (const memberId of payload.member_ids) {
      void this.gateway.emitToUser(memberId, WsEvents.ConversationDisbanded, {
        conversation_id: payload.conversation_id,
        disbanded_by: payload.disbanded_by,
        member_ids: payload.member_ids,
        disbanded_at: payload.disbanded_at,
      });
    }
  }

  @EventPattern(KafkaTopics.ConversationMemberAdded)
  onConversationMemberAdded(@Payload() payload: ConversationMemberAddedEvent) {
    const addedUserIds = payload.members.map((member) => member.user_id);

    this.gateway.broadcastToConversationExceptUsers(
      payload.conversation_id,
      WsEvents.ConversationMemberAdded,
      {
        conversation_id: payload.conversation_id,
        added_by: payload.added_by,
        members: payload.members,
        added_at: payload.added_at,
      },
      addedUserIds,
    );

    for (const member of payload.members) {
      void this.gateway.emitToUser(
        member.user_id,
        WsEvents.ConversationMemberAdded,
        {
          conversation_id: payload.conversation_id,
          added_by: payload.added_by,
          members: payload.members,
          added_at: payload.added_at,
        },
      );
    }
  }

  @EventPattern(KafkaTopics.ConversationMemberRemoved)
  onConversationMemberRemoved(
    @Payload() payload: ConversationMemberRemovedEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationMemberRemoved,
      {
        conversation_id: payload.conversation_id,
        removed_by: payload.removed_by,
        removed_user_id: payload.removed_user_id,
        removed_at: payload.removed_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationMemberRoleUpdated)
  onConversationMemberRoleUpdated(
    @Payload() payload: ConversationMemberRoleUpdatedEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationMemberRoleUpdated,
      {
        conversation_id: payload.conversation_id,
        updated_by: payload.updated_by,
        user_id: payload.user_id,
        previous_role: payload.previous_role,
        current_role: payload.current_role,
        updated_at: payload.updated_at,
      },
    );
  }

  @EventPattern(KafkaTopics.GroupInviteSent)
  onGroupInviteSent(@Payload() payload: GroupInviteSentEvent) {
    void this.gateway.emitToUser(
      payload.invited_user_id,
      WsEvents.GroupInviteSent,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        inviter_full_name: payload.inviter_full_name,
        conversation_name: payload.conversation_name,
        message: payload.message,
        expires_at: payload.expires_at,
        sent_at: payload.sent_at,
      },
    );
  }

  @EventPattern(KafkaTopics.GroupInviteAccepted)
  onGroupInviteAccepted(@Payload() payload: GroupInviteAcceptedEvent) {
    void this.gateway.emitToUser(
      payload.inviter_id,
      WsEvents.GroupInviteAccepted,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        responded_at: payload.responded_at,
      },
    );
    void this.gateway.emitToUser(
      payload.invited_user_id,
      WsEvents.GroupInviteAccepted,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        responded_at: payload.responded_at,
      },
    );
  }

  @EventPattern(KafkaTopics.GroupInviteRejected)
  onGroupInviteRejected(@Payload() payload: GroupInviteRejectedEvent) {
    void this.gateway.emitToUser(
      payload.inviter_id,
      WsEvents.GroupInviteRejected,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        responded_at: payload.responded_at,
      },
    );
  }

  @EventPattern(KafkaTopics.GroupInviteCancelled)
  onGroupInviteCancelled(@Payload() payload: GroupInviteCancelledEvent) {
    void this.gateway.emitToUser(
      payload.invited_user_id,
      WsEvents.GroupInviteCancelled,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        cancelled_at: payload.cancelled_at,
      },
    );
  }

  @EventPattern(KafkaTopics.GroupInviteExpired)
  onGroupInviteExpired(@Payload() payload: GroupInviteExpiredEvent) {
    void this.gateway.emitToUser(
      payload.inviter_id,
      WsEvents.GroupInviteExpired,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        expired_at: payload.expired_at,
      },
    );
    void this.gateway.emitToUser(
      payload.invited_user_id,
      WsEvents.GroupInviteExpired,
      {
        invite_id: payload.invite_id,
        conversation_id: payload.conversation_id,
        inviter_id: payload.inviter_id,
        invited_user_id: payload.invited_user_id,
        status: payload.status,
        expired_at: payload.expired_at,
      },
    );
  }
}
