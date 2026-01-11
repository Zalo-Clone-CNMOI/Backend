import { Controller, OnModuleInit } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type PresenceConnectCommand,
  type PresenceDisconnectCommand,
  type PresenceHeartbeatCommand,
} from '@libs/contracts';
import { PresencePublisher } from '../services/presence.publisher';
import { PresenceStore } from '../services/presence.store';

@Controller()
export class PresenceConsumer implements OnModuleInit {
  constructor(
    private readonly store: PresenceStore,
    private readonly publisher: PresencePublisher,
  ) {}

  onModuleInit() {
    const cleanupIntervalMs = Number(process.env.PRESENCE_CLEANUP_MS ?? 5_000);
    setInterval(() => {
      const expired = this.store.cleanupExpired(Date.now());
      for (const event of expired) {
        this.publisher.emit(KafkaTopics.PresenceUpdated, event);
      }
    }, cleanupIntervalMs).unref();
  }

  @EventPattern(KafkaTopics.PresenceConnect)
  onConnect(@Payload() payload: PresenceConnectCommand) {
    const now = Date.now();
    const event = this.store.upsertOnline(
      payload.user_id,
      payload.socket_id,
      now,
      'connect',
    );
    this.publisher.emit(KafkaTopics.PresenceUpdated, {
      ...event,
      trace_id: payload.trace_id,
    });
  }

  @EventPattern(KafkaTopics.PresenceHeartbeat)
  onHeartbeat(@Payload() payload: PresenceHeartbeatCommand) {
    const now = Date.now();
    const event = this.store.upsertOnline(
      payload.user_id,
      payload.socket_id,
      now,
      'heartbeat',
    );
    this.publisher.emit(KafkaTopics.PresenceUpdated, {
      ...event,
      trace_id: payload.trace_id,
    });
  }

  @EventPattern(KafkaTopics.PresenceDisconnect)
  onDisconnect(@Payload() payload: PresenceDisconnectCommand) {
    const now = Date.now();
    const event = this.store.markOffline(
      payload.user_id,
      payload.socket_id,
      now,
      'disconnect',
    );
    this.publisher.emit(KafkaTopics.PresenceUpdated, {
      ...event,
      trace_id: payload.trace_id,
    });
  }
}
