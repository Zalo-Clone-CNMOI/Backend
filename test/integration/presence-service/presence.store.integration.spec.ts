/**
 * @file presence.store.integration.spec.ts
 *
 * Integration tests for PresenceStore with in-memory Redis mock.
 * Uses real NestJS DI. Tests atomic Lua-script-based operations
 * via evalSha mock with configurable return values.
 *
 * Covers:
 *  - Connect (status change online, duplicate detection)
 *  - Disconnect (status change offline, out-of-order rejection)
 *  - Heartbeat (TTL refresh, missing socket handling)
 *  - Cleanup expired sockets
 *  - Degraded mode behavior
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PresenceStore } from '../../../apps/presence-service/src/services/presence.store';
import { PresenceMetrics } from '../../../apps/presence-service/src/services/presence.metrics';
import { REDIS_CLIENT } from '@libs/redis';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';

describe('PresenceStore (integration)', () => {
  let module: TestingModule;
  let store: PresenceStore;
  let redis: ReturnType<typeof createMockRedisClient>;
  let mockMetrics: Record<string, jest.Mock>;

  beforeAll(async () => {
    redis = createMockRedisClient();

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
      providers: [
        PresenceStore,
        { provide: REDIS_CLIENT, useValue: redis.client },
        { provide: PresenceMetrics, useValue: mockMetrics },
      ],
    }).compile();

    store = module.get(PresenceStore);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    redis.reset();
    jest.clearAllMocks();
  });

  // ─── Initialization ──────────────────────────────────

  describe('onModuleInit', () => {
    it('should load Lua scripts and clear degraded mode', async () => {
      await store.onModuleInit();

      expect(redis.client.scriptLoad).toHaveBeenCalledTimes(3);
      expect(mockMetrics.clearDegradedMode).toHaveBeenCalled();
    });

    it('should enter degraded mode if script loading fails', async () => {
      redis.client.scriptLoad.mockRejectedValueOnce(
        new Error('Redis connection error'),
      );

      await store.onModuleInit();

      expect(mockMetrics.recordDegradedMode).toHaveBeenCalledWith('init');
    });
  });

  // ─── upsertOnline ────────────────────────────────────

  describe('upsertOnline', () => {
    beforeEach(async () => {
      // Ensure scripts are loaded
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should report status change when first socket connects', async () => {
      // Lua returns: [statusChanged=1, socketCount=1, previousSocketCount=0]
      redis.client.evalSha.mockResolvedValue([1, 1, 0]);

      const result = await store.upsertOnline(
        'user-1',
        'socket-1',
        Date.now(),
        'connect',
        Date.now(),
        'trace-1',
      );

      expect(result.statusChanged).toBe(true);
      expect(result.socketCount).toBe(1);
      expect(result.previousSocketCount).toBe(0);
      expect(result.event).not.toBeNull();
      expect(result.event!.status).toBe('online');
      expect(result.event!.user_id).toBe('user-1');
      expect(result.event!.version).toBe('v1');
    });

    it('should NOT report status change for second socket', async () => {
      // Lua returns: [statusChanged=0, socketCount=2, previousSocketCount=1]
      redis.client.evalSha.mockResolvedValue([0, 2, 1]);

      const result = await store.upsertOnline(
        'user-1',
        'socket-2',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(result.statusChanged).toBe(false);
      expect(result.socketCount).toBe(2);
      expect(result.event).toBeNull();
    });

    it('should detect duplicate connect events', async () => {
      // Duplicate: same socket count, no status change
      redis.client.evalSha.mockResolvedValue([0, 1, 1]);

      await store.upsertOnline(
        'user-1',
        'socket-1',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(mockMetrics.recordDuplicateEvent).toHaveBeenCalledWith('connect');
    });

    it('should update active sockets metric', async () => {
      redis.client.evalSha.mockResolvedValue([1, 3, 2]);

      await store.upsertOnline(
        'user-1',
        'socket-3',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(mockMetrics.updateActiveSockets).toHaveBeenCalledWith(3);
    });

    it('should pass correct keys and arguments to Lua script', async () => {
      redis.client.evalSha.mockResolvedValue([1, 1, 0]);

      const now = Date.now();
      await store.upsertOnline(
        'user-1',
        'socket-1',
        now,
        'connect',
        now,
        'trace-1',
      );

      expect(redis.client.evalSha).toHaveBeenCalledWith(
        expect.any(String), // SHA
        expect.objectContaining({
          keys: [
            'presence:socket:socket-1:meta',
            'presence:user:user-1:sockets',
          ],
          arguments: expect.arrayContaining(['socket-1', 'user-1']),
        }),
      );
    });
  });

  // ─── markOffline ──────────────────────────────────────

  describe('markOffline', () => {
    beforeEach(async () => {
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should report status change when last socket disconnects', async () => {
      // Lua returns: [statusChanged=1, socketCount=0, previousSocketCount=1]
      redis.client.evalSha.mockResolvedValue([1, 0, 1]);

      const result = await store.markOffline(
        'user-1',
        'socket-1',
        Date.now(),
        'disconnect',
        Date.now(),
        'logical_disconnect',
        'trace-1',
      );

      expect(result.statusChanged).toBe(true);
      expect(result.socketCount).toBe(0);
      expect(result.event).not.toBeNull();
      expect(result.event!.status).toBe('offline');
      expect(result.event!.offline_reason).toBe('logical_disconnect');
    });

    it('should NOT report status change if other sockets remain', async () => {
      redis.client.evalSha.mockResolvedValue([0, 1, 2]);

      const result = await store.markOffline(
        'user-1',
        'socket-1',
        Date.now(),
        'disconnect',
        Date.now(),
        'logical_disconnect',
      );

      expect(result.statusChanged).toBe(false);
      expect(result.event).toBeNull();
    });

    it('should handle disconnect for already-gone socket', async () => {
      // Socket not found: statusChanged=0, same count
      redis.client.evalSha.mockResolvedValue([0, 0, 0]);

      const result = await store.markOffline(
        'user-1',
        'socket-1',
        Date.now(),
        'disconnect',
        Date.now(),
        'network_drop',
      );

      expect(result.statusChanged).toBe(false);
      expect(mockMetrics.recordDuplicateEvent).toHaveBeenCalledWith(
        'disconnect',
      );
    });
  });

  // ─── heartbeat ────────────────────────────────────────

  describe('heartbeat', () => {
    beforeEach(async () => {
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should succeed for existing socket', async () => {
      // Lua returns: [success=1, socketCount=2]
      redis.client.evalSha.mockResolvedValue([1, 2]);

      const result = await store.heartbeat(
        'user-1',
        'socket-1',
        Date.now(),
        'trace-1',
      );

      expect(result.success).toBe(true);
      expect(result.socketCount).toBe(2);
    });

    it('should fail for non-existent socket', async () => {
      // Lua returns: [success=0, socketCount=0]
      redis.client.evalSha.mockResolvedValue([0, 0]);

      const result = await store.heartbeat(
        'user-1',
        'unknown-socket',
        Date.now(),
      );

      expect(result.success).toBe(false);
      expect(result.socketCount).toBe(0);
    });
  });

  // ─── cleanupExpired ───────────────────────────────────

  describe('cleanupExpired', () => {
    beforeEach(async () => {
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should cleanup expired sockets and emit offline events', async () => {
      const now = Date.now();

      // Setup: scan finds an expired socket
      redis.client.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:socket:sock-1:meta'],
      });

      // hGetAll returns expired meta
      redis.client.hGetAll.mockResolvedValueOnce({
        userId: 'user-1',
        socketId: 'sock-1',
        expiresAt: (now - 1000).toString(),
      });

      // markOffline Lua returns: status changed
      redis.client.evalSha.mockResolvedValueOnce([1, 0, 1]);

      const events = await store.cleanupExpired(now);

      expect(events.length).toBe(1);
      expect(events[0].user_id).toBe('user-1');
      expect(events[0].status).toBe('offline');
      expect(mockMetrics.recordCleanup).toHaveBeenCalledWith(1);
    });

    it('should skip non-expired sockets', async () => {
      const now = Date.now();

      redis.client.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:socket:sock-1:meta'],
      });

      redis.client.hGetAll.mockResolvedValueOnce({
        userId: 'user-1',
        socketId: 'sock-1',
        expiresAt: (now + 30000).toString(), // Not expired
      });

      const events = await store.cleanupExpired(now);

      expect(events.length).toBe(0);
    });

    it('should return empty array when no sockets found', async () => {
      redis.client.scan.mockResolvedValueOnce({ cursor: 0, keys: [] });

      const events = await store.cleanupExpired(Date.now());

      expect(events).toEqual([]);
    });
  });

  // ─── Helper methods ──────────────────────────────────

  describe('getSocketCount & isUserOnline', () => {
    beforeEach(async () => {
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should return socket count from Redis sCard', async () => {
      redis.client.sCard.mockResolvedValue(3);

      const count = await store.getSocketCount('user-1');

      expect(count).toBe(3);
      expect(redis.client.sCard).toHaveBeenCalledWith(
        'presence:user:user-1:sockets',
      );
    });

    it('should return true for online user', async () => {
      redis.client.sCard.mockResolvedValue(1);

      const online = await store.isUserOnline('user-1');

      expect(online).toBe(true);
    });

    it('should return false for offline user', async () => {
      redis.client.sCard.mockResolvedValue(0);

      const online = await store.isUserOnline('user-1');

      expect(online).toBe(false);
    });
  });

  // ─── Degraded Mode ───────────────────────────────────

  describe('Degraded mode', () => {
    it('should skip operations in degraded mode', async () => {
      // Force degraded mode by failing script load
      redis.client.scriptLoad.mockRejectedValue(
        new Error('Connection refused'),
      );
      await store.onModuleInit();

      const result = await store.upsertOnline(
        'user-1',
        'socket-1',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(result.statusChanged).toBe(false);
      expect(result.event).toBeNull();
      expect(mockMetrics.recordDegradedMode).toHaveBeenCalledWith(
        'upsertOnline',
      );
    });

    it('should return empty events on cleanup in degraded mode', async () => {
      redis.client.scriptLoad.mockRejectedValue(
        new Error('Connection refused'),
      );
      await store.onModuleInit();

      const events = await store.cleanupExpired(Date.now());

      expect(events).toEqual([]);
    });
  });

  // ─── Error Handling ───────────────────────────────────

  describe('Error handling', () => {
    beforeEach(async () => {
      redis.client.scriptLoad.mockResolvedValue('mock-sha');
      await store.onModuleInit();
    });

    it('should handle Redis errors gracefully and return empty result', async () => {
      redis.client.evalSha.mockRejectedValue(new Error('Redis timeout'));

      const result = await store.upsertOnline(
        'user-1',
        'socket-1',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(result.statusChanged).toBe(false);
      expect(result.event).toBeNull();
    });

    it('should enter degraded mode on connection error', async () => {
      redis.client.evalSha.mockRejectedValue(
        new Error('ECONNREFUSED connection refused'),
      );

      await store.upsertOnline(
        'user-1',
        'socket-1',
        Date.now(),
        'connect',
        Date.now(),
      );

      // Subsequent calls should be in degraded mode
      const result = await store.upsertOnline(
        'user-2',
        'socket-2',
        Date.now(),
        'connect',
        Date.now(),
      );

      expect(result.statusChanged).toBe(false);
      expect(mockMetrics.recordDegradedMode).toHaveBeenCalled();
    });
  });
});
