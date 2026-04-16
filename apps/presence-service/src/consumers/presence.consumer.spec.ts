/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file presence.consumer.spec.ts
 * @covers PresenceConsumer – Kafka event handlers for presence connect/heartbeat/disconnect
 * @maps TC-KAFKA-004 (consumer routing), TC-SVC-003 (connect/disconnect flow),
 *       TC-SVC-004 (heartbeat), TC-SVC-005 (cleanup), TC-KAFKA-006 (error handling)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PresenceConsumer } from './presence.consumer';
import { PresenceStore } from '../services/presence.store';
import { PresencePublisher } from '../services/presence.publisher';
import { PresenceMetrics } from '../services/presence.metrics';
import { KafkaTopics } from '@libs/contracts';
import type {
  PresenceConnectCommand,
  PresenceDisconnectCommand,
  PresenceHeartbeatCommand,
  PresenceUpdatedEvent,
} from '@libs/contracts';

// ────── Factories ────────────────────────────────────────────────────────

function makeConnectCmd(
  overrides?: Partial<PresenceConnectCommand>,
): PresenceConnectCommand {
  return {
    event_id: 'evt-conn-001',
    emitted_at: Date.now(),
    user_id: 'user-abc',
    socket_id: 'socket-xyz',
    connected_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeDisconnectCmd(
  overrides?: Partial<PresenceDisconnectCommand>,
): PresenceDisconnectCommand {
  return {
    event_id: 'evt-disc-001',
    emitted_at: Date.now(),
    user_id: 'user-abc',
    socket_id: 'socket-xyz',
    disconnected_at: Date.now(),
    trace_id: 'trace-002',
    ...overrides,
  };
}

function makeHeartbeatCmd(
  overrides?: Partial<PresenceHeartbeatCommand>,
): PresenceHeartbeatCommand {
  return {
    event_id: 'evt-hb-001',
    emitted_at: Date.now(),
    user_id: 'user-abc',
    socket_id: 'socket-xyz',
    ts: Date.now(),
    trace_id: 'trace-003',
    ...overrides,
  };
}

function makePresenceEvent(
  overrides?: Partial<PresenceUpdatedEvent>,
): PresenceUpdatedEvent {
  return {
    version: 'v1',
    user_id: 'user-abc',
    status: 'online',
    last_seen_at: Date.now(),
    expires_at: Date.now() + 60000,
    source: 'connect',
    socket_count: 1,
    trace_id: 'trace-001',
    ...overrides,
  };
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('PresenceConsumer', () => {
  let consumer: PresenceConsumer;
  let store: jest.Mocked<PresenceStore>;
  let publisher: jest.Mocked<PresencePublisher>;
  let metrics: jest.Mocked<PresenceMetrics>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PresenceConsumer],
      providers: [
        {
          provide: PresenceStore,
          useValue: {
            upsertOnline: jest.fn(),
            markOffline: jest.fn(),
            heartbeat: jest.fn(),
            cleanupExpired: jest.fn(),
            reconcileStaleSockets: jest.fn(),
          },
        },
        {
          provide: PresencePublisher,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: PresenceMetrics,
          useValue: {
            recordConnect: jest.fn(),
            recordDisconnect: jest.fn(),
            recordHeartbeat: jest.fn(),
            recordCleanup: jest.fn(),
          },
        },
      ],
    }).compile();

    consumer = module.get(PresenceConsumer);
    store = module.get(PresenceStore);
    publisher = module.get(PresencePublisher);
    metrics = module.get(PresenceMetrics);
  });

  // ── onConnect ─────────────────────────────────────────────────────────

  describe('onConnect', () => {
    it('should call store.upsertOnline and emit event when status changes', async () => {
      const cmd = makeConnectCmd();
      const event = makePresenceEvent({ user_id: cmd.user_id });

      store.upsertOnline.mockResolvedValue({
        statusChanged: true,
        socketCount: 1,
        previousSocketCount: 0,
        event,
      });

      await consumer.onConnect(cmd);

      expect(store.upsertOnline).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        cmd.connected_at,
        'connect',
        cmd.emitted_at,
        cmd.trace_id,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        event,
      );
      expect(metrics.recordConnect).toHaveBeenCalledWith('success');
    });

    it('should NOT emit event when no status change (second socket)', async () => {
      const cmd = makeConnectCmd();

      store.upsertOnline.mockResolvedValue({
        statusChanged: false,
        socketCount: 2,
        previousSocketCount: 1,
        event: null,
      });

      await consumer.onConnect(cmd);

      expect(publisher.emit).not.toHaveBeenCalled();
      expect(metrics.recordConnect).toHaveBeenCalledWith('success');
    });

    it('should record failure metric when store throws', async () => {
      const cmd = makeConnectCmd();
      store.upsertOnline.mockRejectedValue(new Error('Redis down'));

      await consumer.onConnect(cmd);

      expect(metrics.recordConnect).toHaveBeenCalledWith('failure');
      expect(publisher.emit).not.toHaveBeenCalled();
    });
  });

  // ── onHeartbeat ───────────────────────────────────────────────────────

  describe('onHeartbeat', () => {
    it('should call store.heartbeat and record success', async () => {
      const cmd = makeHeartbeatCmd();
      store.heartbeat.mockResolvedValue({ success: true, socketCount: 1 });
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

      await consumer.onHeartbeat(cmd);

      expect(store.heartbeat).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        1700000000000,
        cmd.trace_id,
      );
      expect(metrics.recordHeartbeat).toHaveBeenCalledWith('success');

      nowSpy.mockRestore();
    });

    it('should warn and record failure when socket not found', async () => {
      const cmd = makeHeartbeatCmd();
      store.heartbeat.mockResolvedValue({ success: false, socketCount: 0 });

      await consumer.onHeartbeat(cmd);

      expect(metrics.recordHeartbeat).toHaveBeenCalledWith('failure');
    });

    it('should record failure on store error', async () => {
      const cmd = makeHeartbeatCmd();
      store.heartbeat.mockRejectedValue(new Error('Failed'));

      await consumer.onHeartbeat(cmd);

      expect(metrics.recordHeartbeat).toHaveBeenCalledWith('failure');
    });
  });

  // ── onDisconnect ──────────────────────────────────────────────────────

  describe('onDisconnect', () => {
    it('should call store.markOffline and emit event when user goes fully offline', async () => {
      const cmd = makeDisconnectCmd();
      const offlineEvent = makePresenceEvent({
        user_id: cmd.user_id,
        status: 'offline',
        source: 'disconnect',
        offline_reason: 'logical_disconnect',
        socket_count: 0,
      });

      store.markOffline.mockResolvedValue({
        statusChanged: true,
        socketCount: 0,
        previousSocketCount: 1,
        event: offlineEvent,
      });

      await consumer.onDisconnect(cmd);

      expect(store.markOffline).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        cmd.disconnected_at,
        'disconnect',
        cmd.emitted_at,
        'logical_disconnect',
        cmd.trace_id,
      );
      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        offlineEvent,
      );
      expect(metrics.recordDisconnect).toHaveBeenCalledWith(
        'success',
        'logical_disconnect',
      );
    });

    it('should NOT emit event when user still has other sockets', async () => {
      const cmd = makeDisconnectCmd();

      store.markOffline.mockResolvedValue({
        statusChanged: false,
        socketCount: 1,
        previousSocketCount: 2,
        event: null,
      });

      await consumer.onDisconnect(cmd);

      expect(publisher.emit).not.toHaveBeenCalled();
      expect(metrics.recordDisconnect).toHaveBeenCalledWith(
        'success',
        'logical_disconnect',
      );
    });

    it('should record failure metric on store error', async () => {
      const cmd = makeDisconnectCmd();
      store.markOffline.mockRejectedValue(new Error('Redis down'));

      await consumer.onDisconnect(cmd);

      expect(metrics.recordDisconnect).toHaveBeenCalledWith(
        'failure',
        'logical_disconnect',
      );
    });
  });

  // ── onModuleInit (cleanup) ────────────────────────────────────────────

  describe('onModuleInit (cleanup loop)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule periodic cleanup', () => {
      // onModuleInit sets up setInterval
      consumer.onModuleInit();

      // Verify interval was created (implicitly by running timers)
      store.cleanupExpired.mockResolvedValue([]);
      store.reconcileStaleSockets.mockResolvedValue([]);

      jest.advanceTimersByTime(5000);

      // cleanupExpired should have been called at least once
      // (setInterval fires after the interval)
      expect(store.cleanupExpired).toHaveBeenCalled();
    });

    it('should emit events for expired sockets found during cleanup', async () => {
      const expiredEvent = makePresenceEvent({
        status: 'offline',
        source: 'ttl_expire',
        offline_reason: 'ttl_expire',
      });

      store.cleanupExpired.mockResolvedValue([expiredEvent]);
      store.reconcileStaleSockets.mockResolvedValue([]);

      consumer.onModuleInit();

      // Advance time to trigger the interval
      jest.advanceTimersByTime(5000);

      // Flush microtask queue to let async IIFE settle
      await jest.advanceTimersByTimeAsync(0);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        expiredEvent,
      );
    });

    it('should emit events from stale-socket reconciliation', async () => {
      const reconciledEvent = makePresenceEvent({
        status: 'offline',
        source: 'ttl_expire',
        offline_reason: 'ttl_expire',
      });

      store.cleanupExpired.mockResolvedValue([]);
      store.reconcileStaleSockets.mockResolvedValue([reconciledEvent]);

      consumer.onModuleInit();

      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(0);

      expect(publisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        reconciledEvent,
      );
    });

    it('should not throw when cleanup fails', () => {
      store.cleanupExpired.mockRejectedValue(new Error('Scan failed'));

      consumer.onModuleInit();
      jest.advanceTimersByTime(5000);

      // Should not throw — error is caught and logged
      expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    });
  });
});
