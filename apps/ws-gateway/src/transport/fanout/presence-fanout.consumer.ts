import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type PresenceUpdatedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class PresenceFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Handle Presence Updated event
   * MVP: broadcast presence to all connected sockets
   */
  @EventPattern(KafkaTopics.PresenceUpdated)
  onPresenceUpdated(@Payload() payload: PresenceUpdatedEvent) {
    this.gateway.broadcastToAuthenticated(WsEvents.PresenceUpdate, payload);
  }
}
