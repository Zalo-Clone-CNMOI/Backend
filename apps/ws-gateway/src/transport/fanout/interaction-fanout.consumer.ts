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
  type ConversationPollCreatedEvent,
  type ConversationPollEditedEvent,
  type ConversationPollClosedEvent,
  type ConversationPollVoteCastEvent,
  type ConversationPollVoteRetractedEvent,
  type ConversationPollOptionAddedEvent,
  type ConversationPollOptionRemovedEvent,
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

  // ── Conversation Poll Fanout ─────────────────────────────────────────
  // All poll updates broadcast to the conversation room: every group member
  // observes poll state changes simultaneously.
  //
  // Vote-cast / vote-retracted both map to a single lightweight
  // `group:poll:vote:updated` signal. The interaction-service Kafka event
  // does not include the post-vote tally (it would require a join+aggregate
  // before publishing). The FE refetches poll detail on receipt of this
  // signal, so we emit empty `tally`/`total_votes`/`total_voters` and use
  // `voted_at` / `retracted_at` as `updated_at`. This keeps the gateway
  // pure-fanout (no DB calls) and matches the WS payload contract.

  @EventPattern(KafkaTopics.ConversationPollCreated)
  onConversationPollCreated(@Payload() payload: ConversationPollCreatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollCreated,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        message_id: payload.message_id,
        creator_id: payload.creator_id,
        question: payload.question,
        options: payload.options,
        allow_multiple: payload.allow_multiple,
        allow_add_option: payload.allow_add_option,
        expires_at: payload.expires_at,
        created_at: payload.created_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollEdited)
  onConversationPollEdited(@Payload() payload: ConversationPollEditedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollEdited,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        editor_user_id: payload.editor_user_id,
        changes: payload.changes,
        edited_at: payload.edited_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollOptionAdded)
  onConversationPollOptionAdded(
    @Payload() payload: ConversationPollOptionAddedEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollOptionAdded,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        option_id: payload.option_id,
        label: payload.label,
        order_index: payload.order_index,
        added_by_user_id: payload.added_by_user_id,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollOptionRemoved)
  onConversationPollOptionRemoved(
    @Payload() payload: ConversationPollOptionRemovedEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollOptionRemoved,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        option_id: payload.option_id,
        removed_by_user_id: payload.removed_by_user_id,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollClosed)
  onConversationPollClosed(@Payload() payload: ConversationPollClosedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollClosed,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        closed_by_user_id: payload.closed_by_user_id,
        reason: payload.reason,
        final_tally: payload.final_tally,
        closed_at: payload.closed_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollVoteCast)
  onConversationPollVoteCast(
    @Payload() payload: ConversationPollVoteCastEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollVoteUpdated,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        tally: [],
        total_votes: 0,
        total_voters: 0,
        updated_at: payload.voted_at,
      },
    );
  }

  @EventPattern(KafkaTopics.ConversationPollVoteRetracted)
  onConversationPollVoteRetracted(
    @Payload() payload: ConversationPollVoteRetractedEvent,
  ) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ConversationPollVoteUpdated,
      {
        poll_id: payload.poll_id,
        conversation_id: payload.conversation_id,
        tally: [],
        total_votes: 0,
        total_voters: 0,
        updated_at: payload.retracted_at,
      },
    );
  }
}
