/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * @file presence.store.spec.ts
 * @covers PresenceStore – atomic Lua-based Redis presence tracking
 * @maps TC-SVC-003 (connect/disconnect), TC-SVC-004 (heartbeat TTL),
 *       TC-SVC-005 (expire cleanup), TC-CHAOS-002 (degraded mode),
 *       TC-DB-005 (Redis atomicity), TC-KAFKA-005 (event ordering)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PresenceStore } from './presence.store';
import { PresenceMetrics } from './presence.metrics';
import { REDIS_CLIENT } from '@libs/redis';

// ────── Mock Redis client ────────────────────────────────────────────────

function createMockRedis() {
  return {
    scriptLoad: jest.fn().mockResolvedValue('sha256_hash'),
    evalSha: jest.fn(),
    scan: jest.fn(),
    hGetAll: jest.fn(),
    sCard: jest.fn(),
    sMembers: jest.fn(),
    exists: jest.fn(),
    sRem: jest.fn(),
    del: jest.fn(),
  };
}

// ────── Mock Metrics ─────────────────────────────────────────────────────

function createMockMetrics(): Record<string, jest.Mock> {
  return {
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
  };
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('PresenceStore', () => {
  let store: PresenceStore;
  let redis: ReturnType<typeof createMockRedis>;
  let metrics: ReturnType<typeof createMockMetrics>;

  const USER_ID = 'user-abc-123';
  const SOCKET_ID = 'socket-xyz-789';
  const NOW = 1700000000000;
  const TRACE_ID = 'trace-001';

  beforeEach(async () => {
    redis = createMockRedis();
    metrics = createMockMetrics();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceStore,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PresenceMetrics, useValue: metrics },
      ],
    }).compile();

    store = module.get(PresenceStore);
  });

  // ── Initialization ────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should load 3 Lua scripts and exit degraded mode', async () => {
      await store.onModuleInit();

      expect(redis.scriptLoad).toHaveBeenCalledTimes(3);
      expect(metrics.clearDegradedMode).toHaveBeenCalled();
    });

    it('should enter degraded mode when Redis script load fails', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));

      await store.onModuleInit();

      expect(metrics.recordDegradedMode).toHaveBeenCalledWith('init');
    });
  });

  // ── upsertOnline ─────────────────────────────────────────────────────

  describe('upsertOnline', () => {
    beforeEach(async () => {
      await store.onModuleInit(); // Load Lua SHAs
    });

    it('should return status-changed event when user comes online (0→1 sockets)', async () => {
      // Lua returns: [statusChanged=1, socketCount=1, previousSocketCount=0]
      redis.evalSha.mockResolvedValue([1, 1, 0]);

      const result = await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
        TRACE_ID,
      );

      expect(result.statusChanged).toBe(true);
      expect(result.socketCount).toBe(1);
      expect(result.previousSocketCount).toBe(0);
      expect(result.event).toBeDefined();
      expect(result.event!.user_id).toBe(USER_ID);
      expect(result.event!.status).toBe('online');
      expect(result.event!.source).toBe('connect');
      expect(result.event!.socket_count).toBe(1);
      expect(result.event!.trace_id).toBe(TRACE_ID);
      expect(result.event!.version).toBe('v1');
    });

    it('should return no event when user adds second socket (1→2)', async () => {
      // Already online, adding second socket
      redis.evalSha.mockResolvedValue([0, 2, 1]);

      const result = await store.upsertOnline(
        USER_ID,
        'socket-2',
        NOW,
        'connect',
        NOW,
        TRACE_ID,
      );

      expect(result.statusChanged).toBe(false);
      expect(result.socketCount).toBe(2);
      expect(result.event).toBeNull();
    });

    it('should detect duplicate events (same socket count, no status change)', async () => {
      redis.evalSha.mockResolvedValue([0, 1, 1]);

      await store.upsertOnline(USER_ID, SOCKET_ID, NOW, 'connect', NOW);

      expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith('connect');
    });

    it('should update socket metrics on every connect', async () => {
      redis.evalSha.mockResolvedValue([1, 1, 0]);

      await store.upsertOnline(USER_ID, SOCKET_ID, NOW, 'connect', NOW);

      expect(metrics.updateActiveSockets).toHaveBeenCalledWith(1);
    });

    it('should pass correct keys and arguments to Lua script', async () => {
      redis.evalSha.mockResolvedValue([1, 1, 0]);

      await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
        TRACE_ID,
      );

      expect(redis.evalSha).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          keys: [
            `presence:socket:${SOCKET_ID}:meta`,
            `presence:user:${USER_ID}:sockets`,
          ],
          arguments: expect.arrayContaining([
            SOCKET_ID,
            USER_ID,
            NOW.toString(),
          ]),
        }),
      );
    });

    it('should return empty result on Redis error', async () => {
      redis.evalSha.mockRejectedValue(new Error('READONLY'));

      const result = await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
      );

      expect(result).toEqual({
        statusChanged: false,
        socketCount: 0,
        previousSocketCount: 0,
        event: null,
      });
    });

    it('should enter degraded mode on connection error', async () => {
      redis.evalSha.mockRejectedValue(new Error('ECONNREFUSED'));

      await store.upsertOnline(USER_ID, SOCKET_ID, NOW, 'connect', NOW);

      // Subsequent calls should be skipped
      const result2 = await store.upsertOnline(
        USER_ID,
        'socket-2',
        NOW + 100,
        'connect',
        NOW + 100,
      );

      expect(result2.event).toBeNull();
      expect(metrics.recordDegradedMode).toHaveBeenCalledWith('upsertOnline');
    });

    it('should skip operation in degraded mode', async () => {
      // Force degraded mode via failed script load
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const result = await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
      );

      expect(redis.evalSha).not.toHaveBeenCalled();
      expect(result.event).toBeNull();
      expect(metrics.recordDegradedMode).toHaveBeenCalledWith('upsertOnline');
    });
  });

  // ── markOffline ───────────────────────────────────────────────────────

  describe('markOffline', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should return status-changed event when last socket disconnects (1→0)', async () => {
      redis.evalSha.mockResolvedValue([1, 0, 1]);

      const result = await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
        TRACE_ID,
      );

      expect(result.statusChanged).toBe(true);
      expect(result.socketCount).toBe(0);
      expect(result.event).toBeDefined();
      expect(result.event!.status).toBe('offline');
      expect(result.event!.offline_reason).toBe('logical_disconnect');
      expect(result.event!.source).toBe('disconnect');
    });

    it('should return no event when user still has other sockets (2→1)', async () => {
      redis.evalSha.mockResolvedValue([0, 1, 2]);

      const result = await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
      );

      expect(result.statusChanged).toBe(false);
      expect(result.event).toBeNull();
    });

    it('should detect duplicate disconnect events', async () => {
      // Socket already gone
      redis.evalSha.mockResolvedValue([0, 0, 0]);

      await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
      );

      expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith('disconnect');
    });

    it('should handle TTL expire as offline reason', async () => {
      redis.evalSha.mockResolvedValue([1, 0, 1]);

      const result = await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'ttl_expire',
        NOW,
        'ttl_expire',
      );

      expect(result.event!.offline_reason).toBe('ttl_expire');
      expect(result.event!.source).toBe('ttl_expire');
    });

    it('should skip in degraded mode', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const result = await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
      );

      expect(redis.evalSha).not.toHaveBeenCalled();
      expect(result.event).toBeNull();
    });

    it('should return empty result on Redis error', async () => {
      redis.evalSha.mockRejectedValue(new Error('TIMEOUT'));

      const result = await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
      );

      expect(result.socketCount).toBe(0);
      expect(result.event).toBeNull();
    });
  });

  // ── heartbeat ─────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should return success when socket exists', async () => {
      redis.evalSha.mockResolvedValue([1, 2]);

      const result = await store.heartbeat(USER_ID, SOCKET_ID, NOW, TRACE_ID);

      expect(result.success).toBe(true);
      expect(result.socketCount).toBe(2);
    });

    it('should return failure when socket not found', async () => {
      redis.evalSha.mockResolvedValue([0, 0]);

      const result = await store.heartbeat(USER_ID, SOCKET_ID, NOW, TRACE_ID);

      expect(result.success).toBe(false);
      expect(result.socketCount).toBe(0);
    });

    it('should pass TTL parameters to Lua script', async () => {
      redis.evalSha.mockResolvedValue([1, 1]);

      await store.heartbeat(USER_ID, SOCKET_ID, NOW, TRACE_ID);

      expect(redis.evalSha).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          keys: [
            `presence:socket:${SOCKET_ID}:meta`,
            `presence:user:${USER_ID}:sockets`,
          ],
        }),
      );
    });

    it('should skip in degraded mode', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const result = await store.heartbeat(USER_ID, SOCKET_ID, NOW);

      expect(result.success).toBe(false);
      expect(metrics.recordDegradedMode).toHaveBeenCalledWith('heartbeat');
    });

    it('should return failure on Redis error', async () => {
      redis.evalSha.mockRejectedValue(new Error('Redis timeout'));

      const result = await store.heartbeat(USER_ID, SOCKET_ID, NOW);

      expect(result.success).toBe(false);
      expect(result.socketCount).toBe(0);
    });
  });

  // ── cleanupExpired ────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should scan and cleanup expired sockets', async () => {
      // First scan returns 2 keys
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:socket:sock1:meta', 'presence:socket:sock2:meta'],
      });

      // Socket 1 is expired
      redis.hGetAll.mockResolvedValueOnce({
        userId: 'user-1',
        socketId: 'sock1',
        expiresAt: String(NOW - 1000), // expired
      });

      // Socket 2 is still alive
      redis.hGetAll.mockResolvedValueOnce({
        userId: 'user-2',
        socketId: 'sock2',
        expiresAt: String(NOW + 60000), // not expired
      });

      // markOffline for expired socket
      redis.evalSha.mockResolvedValueOnce([1, 0, 1]);

      const events = await store.cleanupExpired(NOW);

      expect(events).toHaveLength(1);
      expect(events[0].user_id).toBe('user-1');
      expect(events[0].status).toBe('offline');
      expect(events[0].source).toBe('ttl_expire');
      expect(metrics.recordCleanup).toHaveBeenCalledWith(1);
    });

    it('should handle multi-page scan (cursor != 0)', async () => {
      // First page
      redis.scan.mockResolvedValueOnce({
        cursor: 42,
        keys: ['presence:socket:sock1:meta'],
      });
      redis.hGetAll.mockResolvedValueOnce({
        userId: 'user-1',
        socketId: 'sock1',
        expiresAt: String(NOW - 500),
      });
      redis.evalSha.mockResolvedValueOnce([1, 0, 1]);

      // Second page (final)
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: [],
      });

      const events = await store.cleanupExpired(NOW);

      expect(redis.scan).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(1);
    });

    it('should return empty array when nothing expired', async () => {
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:socket:sock1:meta'],
      });
      redis.hGetAll.mockResolvedValueOnce({
        userId: 'user-1',
        socketId: 'sock1',
        expiresAt: String(NOW + 99999),
      });

      const events = await store.cleanupExpired(NOW);
      expect(events).toHaveLength(0);
    });

    it('should skip keys with missing metadata', async () => {
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:socket:orphan:meta'],
      });
      redis.hGetAll.mockResolvedValueOnce({});

      const events = await store.cleanupExpired(NOW);
      expect(events).toHaveLength(0);
    });

    it('should return empty array in degraded mode', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const events = await store.cleanupExpired(NOW);
      expect(events).toHaveLength(0);
    });

    it('should handle scan errors gracefully', async () => {
      redis.scan.mockRejectedValue(new Error('Redis error'));

      const events = await store.cleanupExpired(NOW);
      expect(events).toHaveLength(0);
    });
  });

  // ── reconcileStaleSockets ─────────────────────────────────────────────

  describe('reconcileStaleSockets', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should remove stale socket ids and emit offline when user drops to zero sockets', async () => {
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:user:user-1:sockets'],
      });
      redis.sMembers.mockResolvedValueOnce(['sock-stale']);
      redis.exists.mockResolvedValueOnce(0);
      redis.sRem.mockResolvedValueOnce(1);
      redis.sCard.mockResolvedValueOnce(0);
      redis.del.mockResolvedValueOnce(1);

      const events = await store.reconcileStaleSockets(NOW);

      expect(events).toHaveLength(1);
      expect(events[0].user_id).toBe('user-1');
      expect(events[0].status).toBe('offline');
      expect(events[0].source).toBe('ttl_expire');
      expect(events[0].offline_reason).toBe('ttl_expire');
      expect(redis.sRem).toHaveBeenCalledWith('presence:user:user-1:sockets', [
        'sock-stale',
      ]);
    });

    it('should not emit offline when user still has active sockets', async () => {
      redis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['presence:user:user-2:sockets'],
      });
      redis.sMembers.mockResolvedValueOnce(['sock-stale', 'sock-active']);
      redis.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      redis.sRem.mockResolvedValueOnce(1);
      redis.sCard.mockResolvedValueOnce(1);

      const events = await store.reconcileStaleSockets(NOW);

      expect(events).toHaveLength(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should return empty array in degraded mode', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const events = await store.reconcileStaleSockets(NOW);
      expect(events).toHaveLength(0);
    });

    it('should handle reconcile scan errors gracefully', async () => {
      redis.scan.mockRejectedValue(new Error('scan failed'));

      const events = await store.reconcileStaleSockets(NOW);
      expect(events).toHaveLength(0);
    });
  });

  // ── getSocketCount / isUserOnline ─────────────────────────────────────

  describe('getSocketCount', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should return socket count from Redis SCARD', async () => {
      redis.sCard.mockResolvedValue(3);

      const count = await store.getSocketCount(USER_ID);
      expect(count).toBe(3);
      expect(redis.sCard).toHaveBeenCalledWith(
        `presence:user:${USER_ID}:sockets`,
      );
    });

    it('should return 0 on error', async () => {
      redis.sCard.mockRejectedValue(new Error('Redis down'));

      const count = await store.getSocketCount(USER_ID);
      expect(count).toBe(0);
    });

    it('should return 0 in degraded mode', async () => {
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      const count = await store.getSocketCount(USER_ID);
      expect(count).toBe(0);
    });
  });

  describe('isUserOnline', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should return true when socket count > 0', async () => {
      redis.sCard.mockResolvedValue(1);
      expect(await store.isUserOnline(USER_ID)).toBe(true);
    });

    it('should return false when socket count = 0', async () => {
      redis.sCard.mockResolvedValue(0);
      expect(await store.isUserOnline(USER_ID)).toBe(false);
    });
  });

  // ── Degraded Mode Transitions ────────────────────────────────────────

  describe('degraded mode transitions', () => {
    it('should enter degraded mode on ECONNREFUSED during operation', async () => {
      await store.onModuleInit();
      redis.evalSha.mockRejectedValue(new Error('ECONNREFUSED'));

      await store.upsertOnline(USER_ID, SOCKET_ID, NOW, 'connect', NOW);

      // Now all operations should be skipped
      const hbResult = await store.heartbeat(USER_ID, SOCKET_ID, NOW);
      expect(hbResult.success).toBe(false);
      expect(metrics.recordDegradedMode).toHaveBeenCalledWith('heartbeat');
    });

    it('should enter degraded mode on timeout error', async () => {
      await store.onModuleInit();
      redis.evalSha.mockRejectedValue(new Error('timeout waiting for reply'));

      await store.markOffline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'disconnect',
        NOW,
        'logical_disconnect',
      );

      // Verify degraded mode is active
      const result = await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
      );
      expect(result.event).toBeNull();
    });

    it('should NOT enter degraded mode on non-connection error', async () => {
      await store.onModuleInit();
      // NOSCRIPT is a server error, not connection
      redis.evalSha.mockRejectedValueOnce(
        new Error('NOSCRIPT No matching script'),
      );

      await store.upsertOnline(USER_ID, SOCKET_ID, NOW, 'connect', NOW);

      // Should still work (try again)
      redis.evalSha.mockResolvedValueOnce([1, 1, 0]);
      const result = await store.upsertOnline(
        USER_ID,
        'socket-2',
        NOW + 100,
        'connect',
        NOW + 100,
      );
      expect(result.statusChanged).toBe(true);
    });

    it('should recover from degraded mode after successful re-init', async () => {
      // Enter degraded
      redis.scriptLoad.mockRejectedValue(new Error('Connection refused'));
      await store.onModuleInit();

      // Now re-init succeeds
      redis.scriptLoad.mockResolvedValue('new_sha');
      await store.onModuleInit();

      redis.evalSha.mockResolvedValue([1, 1, 0]);

      const result = await store.upsertOnline(
        USER_ID,
        SOCKET_ID,
        NOW,
        'connect',
        NOW,
      );
      expect(result.statusChanged).toBe(true);
      expect(metrics.clearDegradedMode).toHaveBeenCalled();
    });
  });
});
