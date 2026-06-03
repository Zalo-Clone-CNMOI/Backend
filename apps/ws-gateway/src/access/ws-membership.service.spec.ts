/**
 * @file ws-membership.service.spec.ts
 * @covers WsMembershipService — ws-gateway-local cache facade over the
 *         interaction-service membership HTTP client. Verifies cache hit/miss,
 *         request batching, local-only invalidation, and friend-set pair-cache.
 */

import { ConversationType } from '@app/constant';
import { WsMembershipService } from './ws-membership.service';
import type {
  MembershipClientService,
  MembershipEntry,
} from '@app/clients/membership-client';
import type { CacheService } from '@libs/redis';

describe('WsMembershipService', () => {
  let service: WsMembershipService;
  let client: jest.Mocked<
    Pick<
      MembershipClientService,
      | 'getMembershipBatch'
      | 'getSendPermission'
      | 'listActiveMemberIds'
      | 'getFriendSet'
    >
  >;
  let cache: jest.Mocked<Pick<CacheService, 'get' | 'set'>>;

  const entry = (
    id: string,
    allowed: boolean,
    type: ConversationType | null,
  ): MembershipEntry => ({
    conversation_id: id,
    allowed,
    conversation_type: type,
  });

  beforeEach(() => {
    client = {
      getMembershipBatch: jest.fn(),
      getSendPermission: jest.fn(),
      listActiveMemberIds: jest.fn(),
      getFriendSet: jest.fn(),
    };
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };
    service = new WsMembershipService(
      client as unknown as MembershipClientService,
      cache as unknown as CacheService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canUserAccessConversation', () => {
    it('calls the HTTP client on a cache miss and returns the result', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-1', true, ConversationType.GROUP),
      ]);

      const allowed = await service.canUserAccessConversation('u1', 'conv-1');

      expect(allowed).toBe(true);
      expect(client.getMembershipBatch).toHaveBeenCalledWith('u1', ['conv-1']);
    });

    it('serves a second call from cache within TTL (no second HTTP call)', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-1', true, ConversationType.GROUP),
      ]);

      await service.canUserAccessConversation('u1', 'conv-1');
      await service.canUserAccessConversation('u1', 'conv-1');

      expect(client.getMembershipBatch).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent checks in one tick into a single batch call', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-1', true, ConversationType.GROUP),
        entry('conv-2', false, null),
      ]);

      const [a, b] = await Promise.all([
        service.canUserAccessConversation('u1', 'conv-1'),
        service.canUserAccessConversation('u1', 'conv-2'),
      ]);

      expect(a).toBe(true);
      expect(b).toBe(false);
      expect(client.getMembershipBatch).toHaveBeenCalledTimes(1);
      expect(client.getMembershipBatch).toHaveBeenCalledWith('u1', [
        'conv-1',
        'conv-2',
      ]);
    });

    it('returns false for a conversation the user is not a member of', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-x', false, null),
      ]);
      expect(await service.canUserAccessConversation('u1', 'conv-x')).toBe(
        false,
      );
    });
  });

  describe('getCachedConversationType', () => {
    it('returns the co-cached type after an access check', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-1', true, ConversationType.DIRECT),
      ]);

      const type = await service.getCachedConversationType('u1', 'conv-1');

      expect(type).toBe(ConversationType.DIRECT);
    });

    it('returns null when the user has no access', async () => {
      client.getMembershipBatch.mockResolvedValue([
        entry('conv-1', false, null),
      ]);
      expect(
        await service.getCachedConversationType('u1', 'conv-1'),
      ).toBeNull();
    });
  });

  describe('canUserSendMessage', () => {
    it('calls the HTTP client and caches the decision', async () => {
      client.getSendPermission.mockResolvedValue({ allowed: true });

      const first = await service.canUserSendMessage('u1', 'conv-1');
      const second = await service.canUserSendMessage('u1', 'conv-1');

      expect(first).toEqual({ allowed: true });
      expect(second).toEqual({ allowed: true });
      expect(client.getSendPermission).toHaveBeenCalledTimes(1);
    });

    it('propagates the rejection reason', async () => {
      client.getSendPermission.mockResolvedValue({
        allowed: false,
        reason: 'send_permission_denied',
      });
      expect(await service.canUserSendMessage('u1', 'conv-1')).toEqual({
        allowed: false,
        reason: 'send_permission_denied',
      });
    });
  });

  describe('listActiveMemberIds', () => {
    it('delegates to the HTTP client (uncached)', async () => {
      client.listActiveMemberIds.mockResolvedValue(['a', 'b']);

      const r1 = await service.listActiveMemberIds('conv-1');
      const r2 = await service.listActiveMemberIds('conv-1');

      expect(r1).toEqual(['a', 'b']);
      expect(r2).toEqual(['a', 'b']);
      expect(client.listActiveMemberIds).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidation (local only)', () => {
    it('invalidateSettingsCache drops cached send-permission and makes no HTTP call', async () => {
      client.getSendPermission.mockResolvedValue({ allowed: true });
      await service.canUserSendMessage('u1', 'conv-1');

      service.invalidateSettingsCache('conv-1');
      await service.canUserSendMessage('u1', 'conv-1');

      // second call re-fetches because cache was invalidated
      expect(client.getSendPermission).toHaveBeenCalledTimes(2);
    });

    it('invalidateRoleCache drops the specific user+conversation entry', async () => {
      client.getSendPermission.mockResolvedValue({ allowed: true });
      await service.canUserSendMessage('u1', 'conv-1');

      service.invalidateRoleCache('u1', 'conv-1');
      await service.canUserSendMessage('u1', 'conv-1');

      expect(client.getSendPermission).toHaveBeenCalledTimes(2);
    });
  });

  describe('getFriendSet', () => {
    it('includes the reference user as its own friend without a DB hit', async () => {
      cache.get.mockResolvedValue(null);
      client.getFriendSet.mockResolvedValue([]);

      const result = await service.getFriendSet('u1', ['u1']);

      expect(result.has('u1')).toBe(true);
      expect(client.getFriendSet).not.toHaveBeenCalled();
    });

    it('serves friendship from the pair-cache when present', async () => {
      cache.get.mockResolvedValue(true); // cached as friends

      const result = await service.getFriendSet('u1', ['u2']);

      expect(result.has('u2')).toBe(true);
      expect(client.getFriendSet).not.toHaveBeenCalled();
    });

    it('queries HTTP for uncached candidates and writes pair-cache', async () => {
      cache.get.mockResolvedValue(null); // uncached
      client.getFriendSet.mockResolvedValue(['u2']);

      const result = await service.getFriendSet('u1', ['u2', 'u3']);

      expect(client.getFriendSet).toHaveBeenCalledWith('u1', ['u2', 'u3']);
      expect(result.has('u2')).toBe(true);
      expect(result.has('u3')).toBe(false);
      // one cache write per uncached candidate
      expect(cache.set).toHaveBeenCalledTimes(2);
    });

    it('returns empty set for empty candidate list', async () => {
      const result = await service.getFriendSet('u1', []);
      expect(result.size).toBe(0);
      expect(client.getFriendSet).not.toHaveBeenCalled();
    });
  });
});
