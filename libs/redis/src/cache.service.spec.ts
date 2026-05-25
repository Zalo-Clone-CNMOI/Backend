/* eslint-disable @typescript-eslint/require-await */
/**
 * @file cache.service.spec.ts
 * @covers CacheService – domain-specific Redis caching with TTL management
 * @maps TC-CACHE-001 (user cache), TC-CACHE-002 (conversation cache),
 *       TC-CACHE-003 (friend cache), TC-CACHE-004 (message cache),
 *       TC-CACHE-005 (invalidation), TC-CACHE-006 (pattern deletion),
 *       TC-CACHE-007 (health check), TC-RESILIENCE-001 (error handling)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheService, CACHE_LOCK_RENEW_STATUS } from './cache.service';
import { REDIS_CLIENT } from './redis.tokens';

// ────── Mock Redis ───────────────────────────────────────────────────────

function createMockRedis() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    setEx: jest.fn(),
    eval: jest.fn(),
    del: jest.fn(),
    ping: jest.fn(),
    scanIterator: jest.fn(),
  };
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('CacheService', () => {
  let cache: CacheService;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    redis = createMockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    cache = module.get(CacheService);
  });

  // ── Generic get/set/del ───────────────────────────────────────────────

  describe('get', () => {
    it('should parse and return cached JSON', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ name: 'Alice' }));

      const result = await cache.get<{ name: string }>('key1');

      expect(result).toEqual({ name: 'Alice' });
      expect(redis.get).toHaveBeenCalledWith('key1');
    });

    it('should return null when key not found', async () => {
      redis.get.mockResolvedValue(null);

      const result = await cache.get('missing-key');

      expect(result).toBeNull();
    });

    it('should return null on Redis error (not throw)', async () => {
      redis.get.mockRejectedValue(new Error('Redis down'));

      const result = await cache.get('key1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should serialize and store with TTL', async () => {
      await cache.set('key1', { foo: 'bar' }, 300);

      expect(redis.setEx).toHaveBeenCalledWith(
        'key1',
        300,
        JSON.stringify({ foo: 'bar' }),
      );
    });

    it('should not throw on Redis error', async () => {
      redis.setEx.mockRejectedValue(new Error('Redis full'));

      await expect(
        cache.set('key1', { foo: 'bar' }, 300),
      ).resolves.toBeUndefined();
    });
  });

  describe('setIfAbsent', () => {
    it('should return true when NX set succeeds', async () => {
      redis.set.mockResolvedValue('OK');

      const acquired = await cache.setIfAbsent('lock:key', 'token-1', 120);

      expect(acquired).toBe(true);
      expect(redis.set).toHaveBeenCalledWith('lock:key', 'token-1', {
        NX: true,
        EX: 120,
      });
    });

    it('should return false when NX set is rejected by existing key', async () => {
      redis.set.mockResolvedValue(null);

      const acquired = await cache.setIfAbsent('lock:key', 'token-1', 120);

      expect(acquired).toBe(false);
    });

    it('should throw on Redis error', async () => {
      redis.set.mockRejectedValue(new Error('Redis down'));

      await expect(
        cache.setIfAbsent('lock:key', 'token-1', 120),
      ).rejects.toThrow('Redis down');
    });
  });

  describe('expireIfValueMatches', () => {
    it('should renew lock ttl when token matches', async () => {
      redis.eval.mockResolvedValue(1);

      const renewed = await cache.expireIfValueMatches(
        'lock:key',
        'token-1',
        120,
      );

      expect(renewed).toBe(CACHE_LOCK_RENEW_STATUS.Renewed);
      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), {
        keys: ['lock:key'],
        arguments: ['token-1', '120'],
      });
    });

    it('should return mismatch when token does not match', async () => {
      redis.eval.mockResolvedValue(0);

      const renewed = await cache.expireIfValueMatches(
        'lock:key',
        'token-1',
        120,
      );

      expect(renewed).toBe(CACHE_LOCK_RENEW_STATUS.Mismatch);
    });

    it('should return error when Redis eval fails', async () => {
      redis.eval.mockRejectedValue(new Error('Redis unavailable'));

      const renewed = await cache.expireIfValueMatches(
        'lock:key',
        'token-1',
        120,
      );

      expect(renewed).toBe(CACHE_LOCK_RENEW_STATUS.Error);
    });
  });

  describe('delIfValueMatches', () => {
    it('should delete lock key when token matches', async () => {
      redis.eval.mockResolvedValue(1);

      const removed = await cache.delIfValueMatches('lock:key', 'token-1');

      expect(removed).toBe(true);
      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), {
        keys: ['lock:key'],
        arguments: ['token-1'],
      });
    });

    it('should return false when token does not match', async () => {
      redis.eval.mockResolvedValue(0);

      const removed = await cache.delIfValueMatches('lock:key', 'token-1');

      expect(removed).toBe(false);
    });

    it('should return false on Redis eval error', async () => {
      redis.eval.mockRejectedValue(new Error('Redis unavailable'));

      const removed = await cache.delIfValueMatches('lock:key', 'token-1');

      expect(removed).toBe(false);
    });
  });

  describe('del', () => {
    it('should delete specified keys', async () => {
      await cache.del('key1', 'key2');

      expect(redis.del).toHaveBeenCalledWith(['key1', 'key2']);
    });

    it('should do nothing for empty keys', async () => {
      await cache.del();

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should not throw on Redis error', async () => {
      redis.del.mockRejectedValue(new Error('fail'));

      await expect(cache.del('key1')).resolves.toBeUndefined();
    });
  });

  // ── delByPattern ──────────────────────────────────────────────────────

  describe('delByPattern', () => {
    it('should scan and delete matching keys', async () => {
      const keys = ['cache:user:profile:1', 'cache:user:profile:2'];
      redis.scanIterator.mockReturnValue(
        (async function* () {
          for (const k of keys) yield k;
        })(),
      );

      const count = await cache.delByPattern('cache:user:profile:*');

      expect(count).toBe(2);
      expect(redis.del).toHaveBeenCalledWith(keys);
    });

    it('should return 0 when no keys match', async () => {
      redis.scanIterator.mockReturnValue(
        (async function* () {
          // yield nothing
        })(),
      );

      const count = await cache.delByPattern('cache:nonexistent:*');

      expect(count).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should return 0 on scan error', async () => {
      redis.scanIterator.mockImplementation(() => {
        throw new Error('Scan fail');
      });

      const count = await cache.delByPattern('cache:*');

      expect(count).toBe(0);
    });
  });

  // ── User Profile Caching ─────────────────────────────────────────────

  describe('user caching', () => {
    it('should generate correct profile key', () => {
      expect(cache.getUserProfileKey('user-1')).toBe(
        'cache:user:profile:user-1',
      );
    });

    it('should generate correct public key', () => {
      expect(cache.getUserPublicKey('user-1')).toBe('cache:user:public:user-1');
    });

    it('should get/set user profile with 30min TTL', async () => {
      const profile = { id: 'user-1', name: 'Alice' };

      await cache.setUserProfile('user-1', profile);

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:user:profile:user-1',
        1800,
        JSON.stringify(profile),
      );
    });

    it('should get/set user public with 15min TTL', async () => {
      const pub = { id: 'user-1', name: 'Alice' };

      await cache.setUserPublic('user-1', pub);

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:user:public:user-1',
        900,
        JSON.stringify(pub),
      );
    });

    it('should invalidate both profile and public keys', async () => {
      await cache.invalidateUser('user-1');

      expect(redis.del).toHaveBeenCalledWith([
        'cache:user:profile:user-1',
        'cache:user:public:user-1',
      ]);
    });

    it('should bulk invalidate users', async () => {
      await cache.invalidateUsers(['u1', 'u2']);

      expect(redis.del).toHaveBeenCalledWith([
        'cache:user:profile:u1',
        'cache:user:public:u1',
        'cache:user:profile:u2',
        'cache:user:public:u2',
      ]);
    });
  });

  // ── Conversation Caching ──────────────────────────────────────────────

  describe('conversation caching', () => {
    it('should generate correct list key', () => {
      expect(cache.getConversationListKey('user-1')).toBe(
        'cache:conversation:list:user-1',
      );
    });

    it('should generate correct detail key', () => {
      expect(cache.getConversationDetailKey('conv-1')).toBe(
        'cache:conversation:detail:conv-1',
      );
    });

    it('should set conversation list with 5min TTL', async () => {
      await cache.setConversationList('user-1', [{ id: 'conv-1' }]);

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:conversation:list:user-1',
        300,
        expect.any(String),
      );
    });

    it('should set conversation detail with 10min TTL', async () => {
      await cache.setConversationDetail('conv-1', { name: 'Group' });

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:conversation:detail:conv-1',
        600,
        expect.any(String),
      );
    });

    it('should invalidate conversation detail + member lists', async () => {
      await cache.invalidateConversation('conv-1', ['u1', 'u2']);

      expect(redis.del).toHaveBeenCalledWith([
        'cache:conversation:detail:conv-1',
        'cache:conversation:list:u1',
        'cache:conversation:list:u2',
      ]);
    });

    it('should invalidate only detail when no members provided', async () => {
      await cache.invalidateConversation('conv-1');

      expect(redis.del).toHaveBeenCalledWith([
        'cache:conversation:detail:conv-1',
      ]);
    });
  });

  // ── Friend List Caching ───────────────────────────────────────────────

  describe('friend list caching', () => {
    it('should set friend list with 10min TTL', async () => {
      await cache.setFriendList('user-1', ['friend1', 'friend2']);

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:friend:list:user-1',
        600,
        expect.any(String),
      );
    });

    it('should invalidate single friend list', async () => {
      await cache.invalidateFriendList('user-1');

      expect(redis.del).toHaveBeenCalledWith(['cache:friend:list:user-1']);
    });

    it('should bulk invalidate friend lists', async () => {
      await cache.invalidateFriendLists(['u1', 'u2', 'u3']);

      expect(redis.del).toHaveBeenCalledWith([
        'cache:friend:list:u1',
        'cache:friend:list:u2',
        'cache:friend:list:u3',
      ]);
    });
  });

  // ── Recent Messages Caching ───────────────────────────────────────────

  describe('message caching', () => {
    it('should set recent messages with 5min TTL', async () => {
      await cache.setRecentMessages('conv-1', [{ id: 'm1', body: 'hi' }]);

      expect(redis.setEx).toHaveBeenCalledWith(
        'cache:messages:recent:conv-1',
        300,
        expect.any(String),
      );
    });

    it('should invalidate recent messages for conversation', async () => {
      await cache.invalidateRecentMessages('conv-1');

      expect(redis.del).toHaveBeenCalledWith(['cache:messages:recent:conv-1']);
    });
  });

  // ── Health Check ──────────────────────────────────────────────────────

  describe('isHealthy', () => {
    it('should return true when Redis responds to ping', async () => {
      redis.ping.mockResolvedValue('PONG');

      expect(await cache.isHealthy()).toBe(true);
    });

    it('should return false when Redis is down', async () => {
      redis.ping.mockRejectedValue(new Error('Connection refused'));

      expect(await cache.isHealthy()).toBe(false);
    });
  });

  // ── Phase 4: AI Conversation Context (versioned JSON marker) ─────────────

  describe('setAiConversationContext', () => {
    it('stores JSON with version:1 (no TTL)', async () => {
      await cache.setAiConversationContext('conv-001', {
        feature: 'general',
        created_at: 1234,
      });

      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value] = redis.set.mock.calls[0] as [string, string];
      expect(key).toBe('conv:ai:conv-001');
      expect(JSON.parse(value)).toEqual({
        version: 1,
        feature: 'general',
        created_at: 1234,
      });
    });

    it('does not throw on Redis error', async () => {
      redis.set.mockRejectedValue(new Error('Redis full'));

      await expect(
        cache.setAiConversationContext('conv-001', {
          feature: 'general',
          created_at: 0,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getAiConversationContext', () => {
    it('returns parsed object for valid JSON', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          version: 1,
          feature: 'document',
          document_id: 'doc-001',
          created_at: 5,
        }),
      );

      const result = await cache.getAiConversationContext('conv-001');

      expect(result).toMatchObject({
        feature: 'document',
        document_id: 'doc-001',
      });
    });

    it("backward compat: returns general fallback when value is '1'", async () => {
      redis.get.mockResolvedValue('1');

      const result = await cache.getAiConversationContext('conv-001');

      expect(result).toEqual({ feature: 'general', created_at: 0 });
    });

    it('returns null when key missing', async () => {
      redis.get.mockResolvedValue(null);

      const result = await cache.getAiConversationContext('conv-001');

      expect(result).toBeNull();
    });

    it('returns null on invalid JSON (no throw, logs structured error)', async () => {
      redis.get.mockResolvedValue('not-valid-json{{{');

      const result = await cache.getAiConversationContext('conv-001');

      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      redis.get.mockRejectedValue(new Error('Redis down'));

      const result = await cache.getAiConversationContext('conv-001');

      expect(result).toBeNull();
    });
  });

  describe('acquireZaiMentionCooldown', () => {
    it('returns true when NX SET succeeds (first call)', async () => {
      redis.set.mockResolvedValue('OK');

      const acquired = await cache.acquireZaiMentionCooldown('conv-001');

      expect(acquired).toBe(true);
      expect(redis.set).toHaveBeenCalledWith('zai:mention:cd:conv-001', '1', {
        NX: true,
        EX: 5,
      });
    });

    it('returns false when NX SET fails (cooldown active)', async () => {
      redis.set.mockResolvedValue(null);

      const acquired = await cache.acquireZaiMentionCooldown('conv-001');

      expect(acquired).toBe(false);
    });

    it('returns true (fail-open) on Redis error', async () => {
      redis.set.mockRejectedValue(new Error('Redis down'));

      const acquired = await cache.acquireZaiMentionCooldown('conv-001');

      expect(acquired).toBe(true);
    });
  });
});
