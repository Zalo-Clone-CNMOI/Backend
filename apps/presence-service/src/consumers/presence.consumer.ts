import { Controller, Logger, OnModuleInit } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type PresenceConnectCommand,
  type PresenceDisconnectCommand,
  type PresenceHeartbeatCommand,
} from '@libs/contracts';
import { PresencePublisher } from '../services/presence.publisher';
import { PresenceStore } from '../services/presence.store';
import { PresenceMetrics } from '../services/presence.metrics';

@Controller()
export class PresenceConsumer implements OnModuleInit {
  private readonly logger = new Logger(PresenceConsumer.name);

  constructor(
    private readonly store: PresenceStore,
    private readonly publisher: PresencePublisher,
    private readonly metrics: PresenceMetrics,
  ) {}

  onModuleInit() {
    const cleanupIntervalMs = Number(process.env.PRESENCE_CLEANUP_MS ?? 5_000);

    setInterval(() => {
      void (async () => {
        try {
          const expired = await this.store.cleanupExpired(Date.now());
          for (const event of expired) {
            await this.publisher.emit(KafkaTopics.PresenceUpdated, event);
          }
        } catch (error) {
          this.logger.error(
            '[CLEANUP] Failed to cleanup expired sockets',
            error,
          );
        }
      })();
    }, cleanupIntervalMs).unref();

    this.logger.log(`Presence cleanup scheduled every ${cleanupIntervalMs}ms`);
  }

  @EventPattern(KafkaTopics.PresenceConnect)
  async onConnect(@Payload() payload: PresenceConnectCommand) {
    const { user_id, socket_id, connected_at, event_id, emitted_at, trace_id } =
      payload;

    this.logger.debug(
      `[CONNECT] event_id=${event_id} socket=${socket_id} user=${user_id} trace=${trace_id}`,
    );

    try {
      const result = await this.store.upsertOnline(
        user_id,
        socket_id,
        connected_at,
        'connect',
        emitted_at,
        trace_id,
      );

      if (result.event) {
        await this.publisher.emit(KafkaTopics.PresenceUpdated, result.event);
        this.logger.log(
          `[ONLINE] user=${user_id} socket_count=${result.socketCount} trace=${trace_id}`,
        );
      }

      this.metrics.recordConnect('success');
    } catch (error) {
      this.logger.error(
        `[CONNECT] Failed: socket=${socket_id} user=${user_id}`,
        error,
      );
      this.metrics.recordConnect('failure');
    }
  }

  @EventPattern(KafkaTopics.PresenceHeartbeat)
  async onHeartbeat(@Payload() payload: PresenceHeartbeatCommand) {
    const { user_id, socket_id, ts, trace_id } = payload;

    try {
      const result = await this.store.heartbeat(
        user_id,
        socket_id,
        ts,
        trace_id,
      );

      if (!result.success) {
        this.logger.warn(
          `[HEARTBEAT] Socket not found: socket=${socket_id} user=${user_id} trace=${trace_id}`,
        );
        this.metrics.recordHeartbeat('failure');
      } else {
        this.metrics.recordHeartbeat('success');
      }
    } catch (error) {
      this.logger.error(
        `[HEARTBEAT] Failed: socket=${socket_id} user=${user_id}`,
        error,
      );
      this.metrics.recordHeartbeat('failure');
    }
  }

  @EventPattern(KafkaTopics.PresenceDisconnect)
  async onDisconnect(@Payload() payload: PresenceDisconnectCommand) {
    const {
      user_id,
      socket_id,
      disconnected_at,
      event_id,
      emitted_at,
      trace_id,
    } = payload;

    this.logger.debug(
      `[DISCONNECT] event_id=${event_id} socket=${socket_id} user=${user_id} trace=${trace_id}`,
    );

    try {
      const result = await this.store.markOffline(
        user_id,
        socket_id,
        disconnected_at,
        'disconnect',
        emitted_at,
        'logical_disconnect',
        trace_id,
      );

      // Only emit if user status changed (1+ -> 0 sockets)
      if (result.event) {
        await this.publisher.emit(KafkaTopics.PresenceUpdated, result.event);
        this.logger.log(
          `[OFFLINE] user=${user_id} reason=logical_disconnect trace=${trace_id}`,
        );
      }

      this.metrics.recordDisconnect('success', 'logical_disconnect');
    } catch (error) {
      this.logger.error(
        `[DISCONNECT] Failed: socket=${socket_id} user=${user_id}`,
        error,
      );
      this.metrics.recordDisconnect('failure', 'logical_disconnect');
    }
  }
}
