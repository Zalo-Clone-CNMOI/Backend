/**
 * @file presence.consumer.integration.spec.ts
 *
 * Integration tests for PresenceConsumer with real NestJS DI.
 * Verifies the Kafka → PresenceStore → PresencePublisher flow.
 *
 * Covers:
 *  - onConnect: store.upsertOnline → publisher.emit if status changed
 *  - onDisconnect: store.markOffline → publisher.emit if status changed
 *  - onHeartbeat: store.heartbeat
 *  - Metrics recording per outcome
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PresenceConsumer } from '../../../apps/presence-service/src/consumers/presence.consumer';
import { PresenceStore } from '../../../apps/presence-service/src/services/presence.store';
import { PresencePublisher } from '../../../apps/presence-service/src/services/presence.publisher';
import { PresenceMetrics } from '../../../apps/presence-service/src/services/presence.metrics';
import { KafkaTopics } from '@libs/contracts';
import {
  makePresenceConnectCommand,
  makePresenceDisconnectCommand,
  makePresenceHeartbeatCommand,
} from '../../helpers/test-fixtures';

describe('PresenceConsumer (integration)', () => {
  let module: TestingModule;
  let consumer: PresenceConsumer;
  let mockStore: Record<string, jest.Mock>;
  let mockPublisher: Record<string, jest.Mock>;
  let mockMetrics: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockStore = {
      upsertOnline: jest.fn(),
      markOffline: jest.fn(),
      heartbeat: jest.fn(),
      cleanupExpired: jest.fn().mockResolvedValue([]),
      getSocketCount: jest.fn().mockResolvedValue(0),
      isUserOnline: jest.fn().mockResolvedValue(false),
      onModuleInit: jest.fn(),
    };

    mockPublisher = {
      emit: jest.fn().mockResolvedValue(undefined),
      onModuleInit: jest.fn(),
    };

    mockMetrics = {
      recordConnect: jest.fn(),
      recordDisconnect: jest.fn(),
      recordHeartbeat: jest.fn(),
      recordCleanup: jest.fn(),
      recordDegradedMode: jest.fn(),
      clearDegradedMode: jest.fn(),
      recordDuplicateEvent: jest.fn(),
      recordOutOfOrderEvent: jest.fn(),
      updateActiveUsers: jest.fn(),
      updateActiveSockets: jest.fn(),
      onModuleInit: jest.fn(),
    };

    module = await Test.createTestingModule({
      controllers: [PresenceConsumer],
      providers: [
        { provide: PresenceStore, useValue: mockStore },
        { provide: PresencePublisher, useValue: mockPublisher },
        { provide: PresenceMetrics, useValue: mockMetrics },
      ],
    }).compile();

    consumer = module.get(PresenceConsumer);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── onConnect ────────────────────────────────────────

  describe('onConnect', () => {
    it('should call store.upsertOnline and emit event when status changes', async () => {
      const cmd = makePresenceConnectCommand();
      const mockEvent = {
        version: 'v1',
        user_id: cmd.user_id,
        status: 'online',
        last_seen_at: cmd.connected_at,
        expires_at: cmd.connected_at + 60000,
        source: 'connect',
        socket_count: 1,
      };

      mockStore.upsertOnline.mockResolvedValue({
        statusChanged: true,
        socketCount: 1,
        previousSocketCount: 0,
        event: mockEvent,
      });

      await consumer.onConnect(cmd);

      expect(mockStore.upsertOnline).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        cmd.connected_at,
        'connect',
        cmd.emitted_at,
        cmd.trace_id,
      );

      expect(mockPublisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        mockEvent,
      );

      expect(mockMetrics.recordConnect).toHaveBeenCalledWith('success');
    });

    it('should NOT emit event when status does not change', async () => {
      const cmd = makePresenceConnectCommand();

      mockStore.upsertOnline.mockResolvedValue({
        statusChanged: false,
        socketCount: 2,
        previousSocketCount: 1,
        event: null,
      });

      await consumer.onConnect(cmd);

      expect(mockPublisher.emit).not.toHaveBeenCalled();
      expect(mockMetrics.recordConnect).toHaveBeenCalledWith('success');
    });

    it('should record failure metric when store throws', async () => {
      const cmd = makePresenceConnectCommand();
      mockStore.upsertOnline.mockRejectedValue(new Error('Redis error'));

      await consumer.onConnect(cmd);

      expect(mockMetrics.recordConnect).toHaveBeenCalledWith('failure');
    });
  });

  // ─── onHeartbeat ──────────────────────────────────────

  describe('onHeartbeat', () => {
    it('should call store.heartbeat with correct params', async () => {
      const cmd = makePresenceHeartbeatCommand();
      mockStore.heartbeat.mockResolvedValue({ success: true, socketCount: 1 });

      await consumer.onHeartbeat(cmd);

      expect(mockStore.heartbeat).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        cmd.ts,
        cmd.trace_id,
      );

      expect(mockMetrics.recordHeartbeat).toHaveBeenCalledWith('success');
    });

    it('should record failure when socket not found', async () => {
      const cmd = makePresenceHeartbeatCommand();
      mockStore.heartbeat.mockResolvedValue({ success: false, socketCount: 0 });

      await consumer.onHeartbeat(cmd);

      expect(mockMetrics.recordHeartbeat).toHaveBeenCalledWith('failure');
    });

    it('should record failure on error', async () => {
      const cmd = makePresenceHeartbeatCommand();
      mockStore.heartbeat.mockRejectedValue(new Error('timeout'));

      await consumer.onHeartbeat(cmd);

      expect(mockMetrics.recordHeartbeat).toHaveBeenCalledWith('failure');
    });
  });

  // ─── onDisconnect ─────────────────────────────────────

  describe('onDisconnect', () => {
    it('should call store.markOffline and emit event when status changes', async () => {
      const cmd = makePresenceDisconnectCommand();
      const mockEvent = {
        version: 'v1',
        user_id: cmd.user_id,
        status: 'offline',
        last_seen_at: cmd.disconnected_at,
        expires_at: cmd.disconnected_at,
        source: 'disconnect',
        socket_count: 0,
        offline_reason: 'logical_disconnect',
      };

      mockStore.markOffline.mockResolvedValue({
        statusChanged: true,
        socketCount: 0,
        previousSocketCount: 1,
        event: mockEvent,
      });

      await consumer.onDisconnect(cmd);

      expect(mockStore.markOffline).toHaveBeenCalledWith(
        cmd.user_id,
        cmd.socket_id,
        cmd.disconnected_at,
        'disconnect',
        cmd.emitted_at,
        'logical_disconnect',
        cmd.trace_id,
      );

      expect(mockPublisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        mockEvent,
      );

      expect(mockMetrics.recordDisconnect).toHaveBeenCalledWith(
        'success',
        'logical_disconnect',
      );
    });

    it('should NOT emit when status does not change', async () => {
      const cmd = makePresenceDisconnectCommand();

      mockStore.markOffline.mockResolvedValue({
        statusChanged: false,
        socketCount: 1,
        previousSocketCount: 2,
        event: null,
      });

      await consumer.onDisconnect(cmd);

      expect(mockPublisher.emit).not.toHaveBeenCalled();
      expect(mockMetrics.recordDisconnect).toHaveBeenCalledWith(
        'success',
        'logical_disconnect',
      );
    });

    it('should record failure metric on error', async () => {
      const cmd = makePresenceDisconnectCommand();
      mockStore.markOffline.mockRejectedValue(new Error('Redis down'));

      await consumer.onDisconnect(cmd);

      expect(mockMetrics.recordDisconnect).toHaveBeenCalledWith(
        'failure',
        'logical_disconnect',
      );
    });
  });

  // ─── End-to-End Flow ──────────────────────────────────

  describe('Connect → Heartbeat → Disconnect flow', () => {
    it('should handle full lifecycle', async () => {
      const userId = 'user-lifecycle';
      const socketId = 'socket-lifecycle';
      const now = Date.now();

      // 1. Connect
      mockStore.upsertOnline.mockResolvedValue({
        statusChanged: true,
        socketCount: 1,
        previousSocketCount: 0,
        event: {
          version: 'v1',
          user_id: userId,
          status: 'online',
          last_seen_at: now,
          expires_at: now + 60000,
          source: 'connect',
          socket_count: 1,
        },
      });

      await consumer.onConnect(
        makePresenceConnectCommand({
          user_id: userId,
          socket_id: socketId,
          connected_at: now,
          emitted_at: now,
        }),
      );

      expect(mockPublisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        expect.objectContaining({ status: 'online' }),
      );

      jest.clearAllMocks();

      // 2. Heartbeat
      mockStore.heartbeat.mockResolvedValue({ success: true, socketCount: 1 });

      await consumer.onHeartbeat(
        makePresenceHeartbeatCommand({
          user_id: userId,
          socket_id: socketId,
          ts: now + 30000,
        }),
      );

      expect(mockMetrics.recordHeartbeat).toHaveBeenCalledWith('success');

      jest.clearAllMocks();

      // 3. Disconnect
      mockStore.markOffline.mockResolvedValue({
        statusChanged: true,
        socketCount: 0,
        previousSocketCount: 1,
        event: {
          version: 'v1',
          user_id: userId,
          status: 'offline',
          last_seen_at: now + 60000,
          expires_at: now + 60000,
          source: 'disconnect',
          socket_count: 0,
          offline_reason: 'logical_disconnect',
        },
      });

      await consumer.onDisconnect(
        makePresenceDisconnectCommand({
          user_id: userId,
          socket_id: socketId,
          disconnected_at: now + 60000,
          emitted_at: now + 60000,
        }),
      );

      expect(mockPublisher.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceUpdated,
        expect.objectContaining({ status: 'offline' }),
      );
    });
  });
});
