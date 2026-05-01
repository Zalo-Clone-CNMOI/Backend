import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ConversationPinnedEvent,
  type ConversationUnpinnedEvent,
  type ConversationSettingsUpdatedEvent,
  type ConversationMemberRoleUpdatedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';
import { ConversationMembershipService } from '@libs/mvp-access';

@Controller()
export class ConversationFanoutConsumer {
  constructor(
    private readonly gateway: ChatGateway,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  /**
   * Handle conversation pinned event and push to the owner user room.
   */
  @EventPattern(KafkaTopics.ConversationPinned)
  onConversationPinned(@Payload() payload: ConversationPinnedEvent) {
    this.gateway.emitToUser(payload.userId, WsEvents.ConversationPinned, {
      conversationId: payload.conversationId,
      pinnedAt: payload.pinnedAt,
    });
  }

  /**
   * Handle conversation unpinned event and push to the owner user room.
   */
  @EventPattern(KafkaTopics.ConversationUnpinned)
  onConversationUnpinned(@Payload() payload: ConversationUnpinnedEvent) {
    this.gateway.emitToUser(payload.userId, WsEvents.ConversationUnpinned, {
      conversationId: payload.conversationId,
      unpinnedAt: payload.unpinnedAt,
    });
  }

  @EventPattern(KafkaTopics.ConversationSettingsUpdated)
  onConversationSettingsUpdated(
    @Payload() payload: ConversationSettingsUpdatedEvent,
  ): void {
    this.membershipService.invalidateSettingsCache(payload.conversation_id);
  }

  @EventPattern(KafkaTopics.ConversationMemberRoleUpdated)
  onConversationMemberRoleUpdated(
    @Payload() payload: ConversationMemberRoleUpdatedEvent,
  ): void {
    this.membershipService.invalidateRoleCache(
      payload.user_id,
      payload.conversation_id,
    );
  }
}
