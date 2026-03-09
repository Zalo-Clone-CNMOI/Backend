/**
 * @file cache.service.integration.spec.ts
 *
 * Integration tests for CacheService with in-memory Redis mock.
 * Uses real NestJS DI wiring. Tests all domain-specific cache operations
 * including TTL expiry simulation via advanceTime().
 *
 * Covers:
 *  - Generic get/set/del/delByPattern
 *  - User profile & public caching (TTL 1800s / 900s)
 *  - Conversation list & detail caching (TTL 300s / 600s)
 *  - Friend list caching (TTL 600s)
 *  - Recent messages caching (TTL 300s)
 *  - TTL expiry simulation
 *  - Bulk invalidation
 *  - Health check
 */
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '@libs/redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';
import {
  makeUserProfile,
  makeConversationData,
} from '../../helpers/test-fixtures';

describe('CacheService (integration)', () => {
  let module: TestingModule;
  let cache: CacheService;
  let redis: ReturnType<typeof createMockRedisClient>;

  beforeAll(async () => {
    redis = createMockRedisClient();

    module = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis.client },
      ],
    }).compile();

    cache = module.get(CacheService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    redis.reset();
  });

  // ─── Generic Operations ──────────────────────────────

  describe('Generic get/set/del', () => {
    it('should set and get a value', async () => {
      await cache.set('test-key', { data: 'hello' }, 60);

      const result = await cache.get<{ data: string }>('test-key');
      expect(result).toEqual({ data: 'hello' });
    });

    it('should return null for non-existent key', async () => {
      const result = await cache.get('missing-key');
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      await cache.set('k1', 'v1', 60);
      await cache.set('k2', 'v2', 60);

      await cache.del('k1', 'k2');

      expect(await cache.get('k1')).toBeNull();
      expect(await cache.get('k2')).toBeNull();
    });

    it('should handle empty del gracefully', async () => {
      await expect(cache.del()).resolves.not.toThrow();
    });
  });

  // ─── TTL Expiry ──────────────────────────────────────

  describe('TTL expiry', () => {
    it('should expire values after TTL', async () => {
      await cache.set('temp', 'value', 10); // 10 seconds

      // Before expiry
      expect(await cache.get('temp')).toBe('value');

      // Advance past TTL (10 seconds = 10000ms)
      redis.advanceTime(11000);

      expect(await cache.get('temp')).toBeNull();
    });

    it('should not expire values before TTL', async () => {
      await cache.set('alive', 'value', 60);

      redis.advanceTime(30000); // 30 seconds, TTL is 60

      expect(await cache.get('alive')).toBe('value');
    });
  });

  // ─── delByPattern ────────────────────────────────────

  describe('delByPattern', () => {
    it('should delete keys matching pattern', async () => {
      await cache.set('cache:user:profile:u1', 'profile1', 60);
      await cache.set('cache:user:profile:u2', 'profile2', 60);
      await cache.set('cache:other:key', 'other', 60);

      const deleted = await cache.delByPattern('cache:user:profile:*');

      expect(deleted).toBe(2);
      expect(await cache.get('cache:user:profile:u1')).toBeNull();
      expect(await cache.get('cache:other:key')).not.toBeNull();
    });

    it('should return 0 when no keys match', async () => {
      const deleted = await cache.delByPattern('nonexistent:*');
      expect(deleted).toBe(0);
    });
  });

  // ─── User Profile Caching ────────────────────────────

  describe('User profile caching', () => {
    it('should cache and retrieve user profile', async () => {
      const profile = makeUserProfile({ id: 'user-1' });

      await cache.setUserProfile('user-1', profile);
      const result = await cache.getUserProfile<typeof profile>('user-1');

      expect(result).toEqual(profile);
    });

    it('should return null for uncached profile', async () => {
      const result = await cache.getUserProfile('unknown');
      expect(result).toBeNull();
    });

    it('should use correct key format', () => {
      const key = cache.getUserProfileKey('user-123');
      expect(key).toBe('cache:user:profile:user-123');
    });

    it('should expire profile after 1800s', async () => {
      await cache.setUserProfile('user-ttl', { name: 'Test' });

      // Before TTL
      redis.advanceTime(1700 * 1000);
      expect(await cache.getUserProfile('user-ttl')).not.toBeNull();

      // After TTL
      redis.advanceTime(200 * 1000);
      expect(await cache.getUserProfile('user-ttl')).toBeNull();
    });
  });

  // ─── User Public Caching ─────────────────────────────

  describe('User public caching', () => {
    it('should cache and retrieve public profile', async () => {
      const publicProfile = { id: 'user-1', fullName: 'Test User' };

      await cache.setUserPublic('user-1', publicProfile);
      const result = await cache.getUserPublic<typeof publicProfile>('user-1');

      expect(result).toEqual(publicProfile);
    });

    it('should use correct key format', () => {
      const key = cache.getUserPublicKey('user-123');
      expect(key).toBe('cache:user:public:user-123');
    });

    it('should expire public profile after 900s', async () => {
      await cache.setUserPublic('user-pub', { name: 'Test' });

      redis.advanceTime(800 * 1000);
      expect(await cache.getUserPublic('user-pub')).not.toBeNull();

      redis.advanceTime(200 * 1000);
      expect(await cache.getUserPublic('user-pub')).toBeNull();
    });
  });

  // ─── User Invalidation ───────────────────────────────

  describe('User invalidation', () => {
    it('should invalidate both profile and public cache', async () => {
      await cache.setUserProfile('u1', { name: 'Profile' });
      await cache.setUserPublic('u1', { name: 'Public' });

      await cache.invalidateUser('u1');

      expect(await cache.getUserProfile('u1')).toBeNull();
      expect(await cache.getUserPublic('u1')).toBeNull();
    });

    it('should invalidate multiple users in bulk', async () => {
      await cache.setUserProfile('u1', { a: 1 });
      await cache.setUserProfile('u2', { a: 2 });

      await cache.invalidateUsers(['u1', 'u2']);

      expect(await cache.getUserProfile('u1')).toBeNull();
      expect(await cache.getUserProfile('u2')).toBeNull();
    });
  });

  // ─── Conversation Caching ────────────────────────────

  describe('Conversation caching', () => {
    it('should cache conversation list per user', async () => {
      const list = [makeConversationData(), makeConversationData()];

      await cache.setConversationList('user-1', list);
      const result = await cache.getConversationList<typeof list>('user-1');

      expect(result).toHaveLength(2);
    });

    it('should cache conversation detail', async () => {
      const detail = makeConversationData({ id: 'conv-1' });

      await cache.setConversationDetail('conv-1', detail);
      const result = await cache.getConversationDetail<typeof detail>('conv-1');

      expect(result).toEqual(detail);
    });

    it('should use correct key formats', () => {
      expect(cache.getConversationListKey('u1')).toBe(
        'cache:conversation:list:u1',
      );
      expect(cache.getConversationDetailKey('c1')).toBe(
        'cache:conversation:detail:c1',
      );
    });

    it('should expire conversation list after 300s', async () => {
      await cache.setConversationList('user-ttl', []);

      redis.advanceTime(250 * 1000);
      expect(await cache.getConversationList('user-ttl')).not.toBeNull();

      redis.advanceTime(100 * 1000);
      expect(await cache.getConversationList('user-ttl')).toBeNull();
    });

    it('should invalidate conversation and member lists', async () => {
      await cache.setConversationDetail('conv-1', { data: 'detail' });
      await cache.setConversationList('m1', []);
      await cache.setConversationList('m2', []);

      await cache.invalidateConversation('conv-1', ['m1', 'm2']);

      expect(await cache.getConversationDetail('conv-1')).toBeNull();
      expect(await cache.getConversationList('m1')).toBeNull();
      expect(await cache.getConversationList('m2')).toBeNull();
    });

    it('should invalidate single user conversation list', async () => {
      await cache.setConversationList('u1', []);

      await cache.invalidateConversationList('u1');

      expect(await cache.getConversationList('u1')).toBeNull();
    });
  });

  // ─── Friend List Caching ─────────────────────────────

  describe('Friend list caching', () => {
    it('should cache and retrieve friend list', async () => {
      const friends = [{ id: 'f1' }, { id: 'f2' }];

      await cache.setFriendList('user-1', friends);
      const result = await cache.getFriendList<typeof friends>('user-1');

      expect(result).toEqual(friends);
    });

    it('should use correct key format', () => {
      expect(cache.getFriendListKey('u1')).toBe('cache:friend:list:u1');
    });

    it('should invalidate friend list', async () => {
      await cache.setFriendList('u1', []);
      await cache.invalidateFriendList('u1');
      expect(await cache.getFriendList('u1')).toBeNull();
    });

    it('should bulk invalidate friend lists', async () => {
      await cache.setFriendList('u1', []);
      await cache.setFriendList('u2', []);

      await cache.invalidateFriendLists(['u1', 'u2']);

      expect(await cache.getFriendList('u1')).toBeNull();
      expect(await cache.getFriendList('u2')).toBeNull();
    });

    it('should expire friend list after 600s', async () => {
      await cache.setFriendList('user-ttl', []);

      redis.advanceTime(550 * 1000);
      expect(await cache.getFriendList('user-ttl')).not.toBeNull();

      redis.advanceTime(100 * 1000);
      expect(await cache.getFriendList('user-ttl')).toBeNull();
    });
  });

  // ─── Recent Messages Caching ─────────────────────────

  describe('Recent messages caching', () => {
    it('should cache and retrieve recent messages', async () => {
      const messages = [
        { id: 'm1', body: 'Hello' },
        { id: 'm2', body: 'World' },
      ];

      await cache.setRecentMessages('conv-1', messages);
      const result = await cache.getRecentMessages<typeof messages>('conv-1');

      expect(result).toEqual(messages);
    });

    it('should use correct key format', () => {
      expect(cache.getRecentMessagesKey('c1')).toBe('cache:messages:recent:c1');
    });

    it('should invalidate recent messages', async () => {
      await cache.setRecentMessages('conv-1', []);
      await cache.invalidateRecentMessages('conv-1');
      expect(await cache.getRecentMessages('conv-1')).toBeNull();
    });

    it('should expire recent messages after 300s', async () => {
      await cache.setRecentMessages('conv-ttl', []);

      redis.advanceTime(250 * 1000);
      expect(await cache.getRecentMessages('conv-ttl')).not.toBeNull();

      redis.advanceTime(100 * 1000);
      expect(await cache.getRecentMessages('conv-ttl')).toBeNull();
    });
  });

  // ─── Health Check ────────────────────────────────────

  describe('isHealthy', () => {
    it('should return true when Redis responds to PING', async () => {
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
      expect(redis.client.ping).toHaveBeenCalled();
    });

    it('should return false when Redis is down', async () => {
      redis.client.ping.mockRejectedValueOnce(new Error('Not connected'));

      const healthy = await cache.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  // ─── Error Resilience ────────────────────────────────

  describe('Error resilience', () => {
    it('should return null on get error (not throw)', async () => {
      redis.client.get.mockRejectedValueOnce(new Error('Redis error'));

      const result = await cache.get('some-key');
      expect(result).toBeNull();
    });

    it('should not throw on set error', async () => {
      redis.client.setEx.mockRejectedValueOnce(new Error('Redis error'));

      await expect(cache.set('key', 'value', 60)).resolves.not.toThrow();
    });

    it('should not throw on del error', async () => {
      redis.client.del.mockRejectedValueOnce(new Error('Redis error'));

      await expect(cache.del('key')).resolves.not.toThrow();
    });
  });
});
