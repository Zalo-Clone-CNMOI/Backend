import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@libs/redis';
import type {
  PresenceSource,
  PresenceStatus,
  PresenceUpdatedEvent,
  OfflineReason,
} from '@libs/contracts';
import { PresenceMetrics } from './presence.metrics';

const REDIS_PREFIX = 'presence:';
const SOCKET_META_KEY = (socketId: string) =>
  `${REDIS_PREFIX}socket:${socketId}:meta`;
const USER_SOCKETS_KEY = (userId: string) =>
  `${REDIS_PREFIX}user:${userId}:sockets`;

/**
 * Lua script for atomic socket connect
 * Returns: [statusChanged: 0|1, socketCount: number, previousSocketCount: number]
 */
const LUA_CONNECT = `
local socketMetaKey = KEYS[1]
local userSocketsKey = KEYS[2]
local socketId = ARGV[1]
local userId = ARGV[2]
local connectedAt = ARGV[3]
local lastSeenAt = ARGV[4]
local expiresAt = ARGV[5]
local ttlSeconds = tonumber(ARGV[6])
local eventEmittedAt = tonumber(ARGV[7])

-- Check for duplicate/out-of-order events
local existingConnectedAt = redis.call('HGET', socketMetaKey, 'connectedAt')
if existingConnectedAt then
  local existingTs = tonumber(existingConnectedAt)
  if eventEmittedAt <= existingTs then
    -- Out-of-order or duplicate event, skip
    local currentCount = redis.call('SCARD', userSocketsKey)
    return {0, currentCount, currentCount}
  end
end

-- Get previous socket count for user
local previousCount = redis.call('SCARD', userSocketsKey)

-- Add socket to user's socket set
redis.call('SADD', userSocketsKey, socketId)

-- Store socket metadata
redis.call('HSET', socketMetaKey, 
  'userId', userId,
  'socketId', socketId,
  'connectedAt', connectedAt,
  'lastSeenAt', lastSeenAt,
  'expiresAt', expiresAt
)

-- Set TTL on both keys
redis.call('EXPIRE', socketMetaKey, ttlSeconds)
redis.call('EXPIRE', userSocketsKey, ttlSeconds)

-- Get new socket count
local newCount = redis.call('SCARD', userSocketsKey)

-- Status changed if went from 0 to 1
local statusChanged = (previousCount == 0 and newCount > 0) and 1 or 0

return {statusChanged, newCount, previousCount}
`;

/**
 * Lua script for atomic socket disconnect
 * Returns: [statusChanged: 0|1, socketCount: number, previousSocketCount: number]
 */
const LUA_DISCONNECT = `
local socketMetaKey = KEYS[1]
local userSocketsKey = KEYS[2]
local socketId = ARGV[1]
local eventEmittedAt = tonumber(ARGV[2])

-- Check socket exists
local existingConnectedAt = redis.call('HGET', socketMetaKey, 'connectedAt')
if not existingConnectedAt then
  -- Socket already gone, skip
  local currentCount = redis.call('SCARD', userSocketsKey)
  return {0, currentCount, currentCount}
end

-- Check for out-of-order events (disconnect before connect)
local existingTs = tonumber(existingConnectedAt)
if eventEmittedAt < existingTs then
  -- Out-of-order event, skip
  local currentCount = redis.call('SCARD', userSocketsKey)
  return {0, currentCount, currentCount}
end

-- Get previous socket count
local previousCount = redis.call('SCARD', userSocketsKey)

-- Remove socket from user's socket set
redis.call('SREM', userSocketsKey, socketId)

-- Delete socket metadata
redis.call('DEL', socketMetaKey)

-- Get new socket count
local newCount = redis.call('SCARD', userSocketsKey)

-- Status changed if went from 1+ to 0
local statusChanged = (previousCount > 0 and newCount == 0) and 1 or 0

return {statusChanged, newCount, previousCount}
`;

/**
 * Lua script for heartbeat (update TTL only)
 * Returns: [success: 0|1]
 */
const LUA_HEARTBEAT = `
local socketMetaKey = KEYS[1]
local userSocketsKey = KEYS[2]
local lastSeenAt = ARGV[1]
local expiresAt = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

-- Check socket exists
local exists = redis.call('EXISTS', socketMetaKey)
if exists == 0 then
  return {0, 0}
end

-- Update last seen and expiry
redis.call('HSET', socketMetaKey, 'lastSeenAt', lastSeenAt, 'expiresAt', expiresAt)
redis.call('EXPIRE', socketMetaKey, ttlSeconds)
redis.call('EXPIRE', userSocketsKey, ttlSeconds)

local socketCount = redis.call('SCARD', userSocketsKey)
return {1, socketCount}
`;

export interface PresenceResult {
  statusChanged: boolean;
  socketCount: number;
  previousSocketCount: number;
  event: PresenceUpdatedEvent | null;
}

@Injectable()
export class PresenceStore implements OnModuleInit {
  private readonly logger = new Logger(PresenceStore.name);
  private readonly ttlMs = Number(process.env.PRESENCE_TTL_MS ?? 60_000);
  private readonly ttlSeconds = Math.ceil(this.ttlMs / 1000);

  private connectSha: string | null = null;
  private disconnectSha: string | null = null;
  private heartbeatSha: string | null = null;

  private degradedMode = false;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClientType,
    private readonly metrics: PresenceMetrics,
  ) {}

  async onModuleInit() {
    try {
      this.connectSha = await this.redis.scriptLoad(LUA_CONNECT);
      this.disconnectSha = await this.redis.scriptLoad(LUA_DISCONNECT);
      this.heartbeatSha = await this.redis.scriptLoad(LUA_HEARTBEAT);
      this.logger.log('Lua scripts loaded successfully');
      this.degradedMode = false;
      this.metrics.clearDegradedMode();
    } catch (error) {
      this.logger.error(
        'Failed to load Lua scripts, entering degraded mode',
        error,
      );
      this.degradedMode = true;
      this.metrics.recordDegradedMode('init');
    }
  }

  /**
   * Handle socket connect with atomic Redis operation
   */
  async upsertOnline(
    userId: string,
    socketId: string,
    now: number,
    source: PresenceSource,
    emittedAt: number,
    traceId?: string,
  ): Promise<PresenceResult> {
    if (this.degradedMode) {
      this.logger.warn(
        `[DEGRADED] Skipping connect: socket=${socketId} user=${userId}`,
      );
      this.metrics.recordDegradedMode('upsertOnline');
      return this.emptyResult();
    }

    const expiresAt = now + this.ttlMs;

    try {
      const result = (await this.redis.evalSha(this.connectSha!, {
        keys: [SOCKET_META_KEY(socketId), USER_SOCKETS_KEY(userId)],
        arguments: [
          socketId,
          userId,
          now.toString(),
          now.toString(),
          expiresAt.toString(),
          this.ttlSeconds.toString(),
          emittedAt.toString(),
        ],
      })) as [number, number, number];

      const [statusChanged, socketCount, previousSocketCount] = result;

      this.logger.debug(
        `[CONNECT] socket=${socketId} user=${userId} statusChanged=${statusChanged} count=${socketCount} trace=${traceId}`,
      );

      if (socketCount === previousSocketCount && statusChanged === 0) {
        this.metrics.recordDuplicateEvent('connect');
      }

      this.metrics.updateActiveSockets(socketCount);

      if (statusChanged === 1) {
        return {
          statusChanged: true,
          socketCount,
          previousSocketCount,
          event: this.buildEvent(
            userId,
            'online',
            now,
            expiresAt,
            source,
            socketCount,
            traceId,
          ),
        };
      }

      return {
        statusChanged: false,
        socketCount,
        previousSocketCount,
        event: null,
      };
    } catch (error) {
      this.handleRedisError('upsertOnline', error, socketId, userId);
      return this.emptyResult();
    }
  }

  /**
   * Handle socket disconnect with atomic Redis operation
   */
  async markOffline(
    userId: string,
    socketId: string,
    now: number,
    source: PresenceSource,
    emittedAt: number,
    offlineReason: OfflineReason,
    traceId?: string,
  ): Promise<PresenceResult> {
    if (this.degradedMode) {
      this.logger.warn(
        `[DEGRADED] Skipping disconnect: socket=${socketId} user=${userId}`,
      );
      this.metrics.recordDegradedMode('markOffline');
      return this.emptyResult();
    }

    try {
      const result = (await this.redis.evalSha(this.disconnectSha!, {
        keys: [SOCKET_META_KEY(socketId), USER_SOCKETS_KEY(userId)],
        arguments: [socketId, emittedAt.toString()],
      })) as [number, number, number];

      const [statusChanged, socketCount, previousSocketCount] = result;

      this.logger.debug(
        `[DISCONNECT] socket=${socketId} user=${userId} reason=${offlineReason} statusChanged=${statusChanged} count=${socketCount} trace=${traceId}`,
      );

      if (socketCount === previousSocketCount && statusChanged === 0) {
        this.metrics.recordDuplicateEvent('disconnect');
      }

      this.metrics.updateActiveSockets(socketCount);

      if (statusChanged === 1) {
        return {
          statusChanged: true,
          socketCount,
          previousSocketCount,
          event: this.buildEvent(
            userId,
            'offline',
            now,
            now,
            source,
            socketCount,
            traceId,
            offlineReason,
          ),
        };
      }

      return {
        statusChanged: false,
        socketCount,
        previousSocketCount,
        event: null,
      };
    } catch (error) {
      this.handleRedisError('markOffline', error, socketId, userId);
      return this.emptyResult();
    }
  }

  /**
   * Handle heartbeat - just update TTL, no status change events
   */
  async heartbeat(
    userId: string,
    socketId: string,
    now: number,
    traceId?: string,
  ): Promise<{ success: boolean; socketCount: number }> {
    if (this.degradedMode) {
      this.logger.warn(
        `[DEGRADED] Skipping heartbeat: socket=${socketId} user=${userId}`,
      );
      this.metrics.recordDegradedMode('heartbeat');
      return { success: false, socketCount: 0 };
    }

    const expiresAt = now + this.ttlMs;

    try {
      const result = (await this.redis.evalSha(this.heartbeatSha!, {
        keys: [SOCKET_META_KEY(socketId), USER_SOCKETS_KEY(userId)],
        arguments: [
          now.toString(),
          expiresAt.toString(),
          this.ttlSeconds.toString(),
        ],
      })) as [number, number];

      const [success, socketCount] = result;

      if (success === 0) {
        this.logger.warn(
          `[HEARTBEAT] Socket not found: socket=${socketId} user=${userId} trace=${traceId}`,
        );
      }

      return { success: success === 1, socketCount };
    } catch (error) {
      this.handleRedisError('heartbeat', error, socketId, userId);
      return { success: false, socketCount: 0 };
    }
  }

  /**
   * Scan for expired sockets and cleanup (called periodically)
   * Note: Redis TTL handles auto-cleanup, but we need to emit offline events
   */
  async cleanupExpired(now: number): Promise<PresenceUpdatedEvent[]> {
    if (this.degradedMode) {
      return [];
    }

    const events: PresenceUpdatedEvent[] = [];

    try {
      // Scan for socket meta keys
      const pattern = `${REDIS_PREFIX}socket:*:meta`;
      let cursor = 0;

      do {
        const scanResult = await this.redis.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });

        cursor = scanResult.cursor;

        for (const key of scanResult.keys) {
          const meta = await this.redis.hGetAll(key);

          if (!meta || !meta.expiresAt) continue;

          const expiresAt = parseInt(meta.expiresAt, 10);

          if (expiresAt <= now) {
            const userId = meta.userId;
            const socketId = meta.socketId;

            if (userId && socketId) {
              const result = await this.markOffline(
                userId,
                socketId,
                now,
                'ttl_expire',
                now,
                'ttl_expire',
              );

              if (result.event) {
                events.push(result.event);
              }
            }
          }
        }
      } while (cursor !== 0);

      if (events.length > 0) {
        this.logger.log(`[CLEANUP] Expired ${events.length} sockets`);
        this.metrics.recordCleanup(events.length);
      }
    } catch (error) {
      this.logger.error('[CLEANUP] Error during cleanup scan', error);
    }

    return events;
  }

  /**
   * Reconcile stale socket ids left behind in user socket sets when socket
   * metadata keys have already expired.
   */
  async reconcileStaleSockets(now: number): Promise<PresenceUpdatedEvent[]> {
    if (this.degradedMode) {
      return [];
    }

    const events: PresenceUpdatedEvent[] = [];
    const pattern = `${REDIS_PREFIX}user:*:sockets`;
    let cursor = 0;

    try {
      do {
        const scanResult = await this.redis.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });

        cursor = scanResult.cursor;

        for (const userSocketsKey of scanResult.keys) {
          const userId = this.extractUserIdFromSocketsKey(userSocketsKey);
          if (!userId) continue;

          const socketIds = await this.redis.sMembers(userSocketsKey);
          if (socketIds.length === 0) continue;

          const staleSocketIds: string[] = [];
          for (const socketId of socketIds) {
            const exists = await this.redis.exists(SOCKET_META_KEY(socketId));
            if (exists === 0) {
              staleSocketIds.push(socketId);
            }
          }

          if (staleSocketIds.length === 0) continue;

          const previousCount = socketIds.length;
          await this.redis.sRem(userSocketsKey, staleSocketIds);
          const socketCount = await this.redis.sCard(userSocketsKey);

          if (socketCount === 0) {
            await this.redis.del(userSocketsKey);
          }

          this.metrics.updateActiveSockets(socketCount);

          if (previousCount > 0 && socketCount === 0) {
            events.push(
              this.buildEvent(
                userId,
                'offline',
                now,
                now,
                'ttl_expire',
                socketCount,
                undefined,
                'ttl_expire',
              ),
            );
          }
        }
      } while (cursor !== 0);
    } catch (error) {
      this.logger.error(
        '[RECONCILE] Error while reconciling stale sockets',
        error,
      );
    }

    if (events.length > 0) {
      this.logger.log(
        `[RECONCILE] Reconciled stale sockets for ${events.length} users`,
      );
    }

    return events;
  }

  /**
   * Get current socket count for a user (for debugging/metrics)
   */
  async getSocketCount(userId: string): Promise<number> {
    if (this.degradedMode) return 0;

    try {
      return await this.redis.sCard(USER_SOCKETS_KEY(userId));
    } catch {
      return 0;
    }
  }

  /**
   * Check if user is online (derived from socket count)
   */
  async isUserOnline(userId: string): Promise<boolean> {
    return (await this.getSocketCount(userId)) > 0;
  }

  private extractUserIdFromSocketsKey(key: string): string | null {
    const prefix = `${REDIS_PREFIX}user:`;
    const suffix = ':sockets';

    if (!key.startsWith(prefix) || !key.endsWith(suffix)) {
      return null;
    }

    const userId = key.slice(prefix.length, -suffix.length);
    return userId.length > 0 ? userId : null;
  }

  private buildEvent(
    userId: string,
    status: PresenceStatus,
    lastSeenAt: number,
    expiresAt: number,
    source: PresenceSource,
    socketCount: number,
    traceId?: string,
    offlineReason?: OfflineReason,
  ): PresenceUpdatedEvent {
    return {
      version: 'v1',
      user_id: userId,
      status,
      last_seen_at: lastSeenAt,
      expires_at: expiresAt,
      source,
      socket_count: socketCount,
      trace_id: traceId,
      offline_reason: offlineReason,
    };
  }

  private emptyResult(): PresenceResult {
    return {
      statusChanged: false,
      socketCount: 0,
      previousSocketCount: 0,
      event: null,
    };
  }

  private handleRedisError(
    operation: string,
    error: unknown,
    socketId: string,
    userId: string,
  ): void {
    this.logger.error(
      `[${operation}] Redis error: socket=${socketId} user=${userId}`,
      error,
    );

    // Enter degraded mode if Redis is down
    if (this.isConnectionError(error)) {
      this.degradedMode = true;
      this.logger.warn(
        '[DEGRADED] Entering degraded mode due to Redis connection failure',
      );
    }
  }

  private isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('connection') ||
        msg.includes('econnrefused') ||
        msg.includes('timeout')
      );
    }
    return false;
  }
}
