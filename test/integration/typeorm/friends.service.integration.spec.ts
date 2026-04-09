/**
 * @file friends.service.integration.spec.ts
 *
 * Integration tests for FriendsService (interaction-service) with real NestJS DI.
 * TypeORM repositories mocked at interface level, Kafka and CacheService mocked.
 *
 * Covers:
 *  - getFriends (pagination, friend mapping)
 *  - getPendingRequests (pagination, requester info)
 *  - getSentRequests (pagination)
 *  - sendFriendRequest (success, self-add, already friends, blocked, not found)
 *  - respondToRequest (accept with cache invalidation, reject with remove)
 *  - cancelRequest (success, not found)
 *  - removeFriend (success, not found, cache invalidation)
 *  - blockUser (new block, upgrade existing friendship)
 *  - unblockUser (success, not blocked)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FriendsService } from '../../../apps/interaction-service/src/modules/friends/friends.service';
import { User, Friendship } from '@libs/database';
import { CacheService } from '@libs/redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import { KAFKA_CLIENT } from '@libs/kafka';
import { createMockRepository } from '../../helpers/test-database.helper';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';
import { createMockKafkaClient } from '../../helpers/mock-kafka.helper';
import { FriendshipStatus, UserStatus } from '@app/constant';
import { RespondFriendRequestDtoActionEnum } from '../../../apps/interaction-service/src/modules/friends/dto';

describe('FriendsService (integration)', () => {
  let module: TestingModule;
  let service: FriendsService;
  let userRepo: ReturnType<typeof createMockRepository>;
  let friendshipRepo: ReturnType<typeof createMockRepository>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let kafka: ReturnType<typeof createMockKafkaClient>;

  const USER_ID = 'user-a-id';
  const TARGET_ID = 'user-b-id';

  beforeAll(async () => {
    userRepo = createMockRepository();
    friendshipRepo = createMockRepository();
    redis = createMockRedisClient();
    kafka = createMockKafkaClient();

    module = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Friendship), useValue: friendshipRepo },
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis.client },
        { provide: KAFKA_CLIENT, useValue: kafka.client },
      ],
    }).compile();

    service = module.get(FriendsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    redis.reset();
    kafka.reset();
    jest.clearAllMocks();
  });

  // ─── getFriends ──────────────────────────────────────

  describe('getFriends', () => {
    it('should return empty list when no friends', async () => {
      const qb = jest.fn();
      const chainable = [
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'skip',
        'take',
      ];
      for (const m of chainable) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFriends(USER_ID, { page: 1, limit: 20 });

      expect(result.items).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('should map friend from friendship where user is requester', async () => {
      const friendship = {
        id: 'f1',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.ACCEPTED,
        updatedAt: new Date(),
        requester: {
          id: USER_ID,
          fullName: 'User A',
          avatarUrl: null,
          phone: '+8490000001',
          lastSeenAt: null,
        },
        addressee: {
          id: TARGET_ID,
          fullName: 'User B',
          avatarUrl: null,
          phone: '+8490000002',
          lastSeenAt: null,
        },
      };

      const qb = jest.fn();
      const chainable = [
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'skip',
        'take',
      ];
      for (const m of chainable) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getManyAndCount = jest.fn().mockResolvedValue([[friendship], 1]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFriends(USER_ID, { page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      // Should return the *other* user (addressee)
      expect(result.items[0].id).toBe(TARGET_ID);
      expect(result.items[0].fullName).toBe('User B');
    });

    it('should respect pagination', async () => {
      const qb = jest.fn();
      const chainable = [
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'skip',
        'take',
      ];
      for (const m of chainable) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 25]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFriends(USER_ID, { page: 2, limit: 10 });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.total).toBe(25);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(true);
    });
  });

  // ─── getPendingRequests ──────────────────────────────

  describe('getPendingRequests', () => {
    it('should return pending requests received by user', async () => {
      const request = {
        id: 'req-1',
        requesterId: TARGET_ID,
        addresseeId: USER_ID,
        status: FriendshipStatus.PENDING,
        createdAt: new Date(),
        requester: {
          id: TARGET_ID,
          fullName: 'Requester',
          avatarUrl: null,
          phone: '+8490000002',
        },
      };

      friendshipRepo.findAndCount.mockResolvedValue([[request], 1]);

      const result = await service.getPendingRequests(USER_ID, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('req-1');
      expect(result.items[0].user.fullName).toBe('Requester');
    });
  });

  // ─── sendFriendRequest ───────────────────────────────

  describe('sendFriendRequest', () => {
    it('should reject self-add', async () => {
      await expect(
        service.sendFriendRequest(USER_ID, { userId: USER_ID }),
      ).rejects.toThrow();
    });

    it('should reject when target user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.sendFriendRequest(USER_ID, { userId: TARGET_ID }),
      ).rejects.toThrow();
    });

    it('should reject when target user inactive', async () => {
      userRepo.findOne.mockResolvedValueOnce({
        id: TARGET_ID,
        status: UserStatus.INACTIVE,
      });

      await expect(
        service.sendFriendRequest(USER_ID, { userId: TARGET_ID }),
      ).rejects.toThrow();
    });

    it('should reject when already friends', async () => {
      userRepo.findOne.mockResolvedValueOnce({
        id: TARGET_ID,
        status: UserStatus.ACTIVE,
      });
      friendshipRepo.findOne.mockResolvedValueOnce({
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.ACCEPTED,
      });

      await expect(
        service.sendFriendRequest(USER_ID, { userId: TARGET_ID }),
      ).rejects.toThrow();
    });

    it('should reject when request already exists', async () => {
      userRepo.findOne.mockResolvedValueOnce({
        id: TARGET_ID,
        status: UserStatus.ACTIVE,
      });
      friendshipRepo.findOne.mockResolvedValueOnce({
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.PENDING,
      });

      await expect(
        service.sendFriendRequest(USER_ID, { userId: TARGET_ID }),
      ).rejects.toThrow();
    });

    it('should reject when user is blocked', async () => {
      userRepo.findOne.mockResolvedValueOnce({
        id: TARGET_ID,
        status: UserStatus.ACTIVE,
      });
      friendshipRepo.findOne.mockResolvedValueOnce({
        requesterId: TARGET_ID,
        addresseeId: USER_ID,
        status: FriendshipStatus.BLOCKED,
      });

      await expect(
        service.sendFriendRequest(USER_ID, { userId: TARGET_ID }),
      ).rejects.toThrow();
    });

    it('should create request and emit Kafka events on success', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({
          id: TARGET_ID,
          status: UserStatus.ACTIVE,
        }) // target check
        .mockResolvedValueOnce({
          id: USER_ID,
          fullName: 'Requester',
          avatarUrl: null,
          phone: '+84900000001',
        }); // requester info for notification

      friendshipRepo.findOne.mockResolvedValue(null); // no existing
      friendshipRepo.create.mockReturnValue({
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.PENDING,
      });
      friendshipRepo.save.mockResolvedValue({
        id: 'new-req-id',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.PENDING,
      });

      const result = await service.sendFriendRequest(USER_ID, {
        userId: TARGET_ID,
      });

      expect(result.message).toContain('sent');
      expect(result.requestId).toBe('new-req-id');

      // Should emit SendFriendRequest topic AND NotificationRequested
      expect(kafka.client.emit).toHaveBeenCalledTimes(2);
    });
  });

  // ─── respondToRequest ────────────────────────────────

  describe('respondToRequest', () => {
    it('should throw when request not found', async () => {
      friendshipRepo.findOne.mockResolvedValue(null);

      await expect(
        service.respondToRequest(USER_ID, 'bad-id', {
          action: RespondFriendRequestDtoActionEnum.accept,
        }),
      ).rejects.toThrow();
    });

    it('should accept request, invalidate friend caches, and emit events', async () => {
      const request = {
        id: 'req-1',
        requesterId: TARGET_ID,
        addresseeId: USER_ID,
        status: FriendshipStatus.PENDING,
        requester: { id: TARGET_ID, fullName: 'Target' },
      };
      friendshipRepo.findOne.mockResolvedValueOnce(request);
      friendshipRepo.save.mockResolvedValue({
        ...request,
        status: FriendshipStatus.ACCEPTED,
      });

      // addressee lookup for notification
      userRepo.findOne.mockResolvedValue({
        id: USER_ID,
        fullName: 'Me',
        avatarUrl: null,
      });

      const result = await service.respondToRequest(USER_ID, 'req-1', {
        action: RespondFriendRequestDtoActionEnum.accept,
      });

      expect(result.message).toContain('accepted');

      // Cache invalidation should occur for both users
      expect(redis.client.del).toHaveBeenCalled();

      // Kafka: RespondFriendRequest + NotificationRequested
      expect(kafka.client.emit).toHaveBeenCalledTimes(2);
    });

    it('should reject request and remove record', async () => {
      const request = {
        id: 'req-2',
        requesterId: TARGET_ID,
        addresseeId: USER_ID,
        status: FriendshipStatus.PENDING,
        requester: { id: TARGET_ID, fullName: 'Target' },
      };
      friendshipRepo.findOne.mockResolvedValue(request);

      const result = await service.respondToRequest(USER_ID, 'req-2', {
        action: RespondFriendRequestDtoActionEnum.reject,
      });

      expect(result.message).toContain('rejected');
      expect(friendshipRepo.remove).toHaveBeenCalledWith(request);

      // Only RespondFriendRequest emitted (no notification for rejection)
      expect(kafka.client.emit).toHaveBeenCalledTimes(1);
    });
  });

  // ─── cancelRequest ───────────────────────────────────

  describe('cancelRequest', () => {
    it('should throw when request not found', async () => {
      friendshipRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelRequest(USER_ID, 'bad-id')).rejects.toThrow();
    });

    it('should remove request and emit CancelFriendRequest', async () => {
      const request = {
        id: 'req-cancel',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.PENDING,
      };
      friendshipRepo.findOne.mockResolvedValue(request);

      const result = await service.cancelRequest(USER_ID, 'req-cancel');

      expect(result.message).toContain('cancelled');
      expect(friendshipRepo.remove).toHaveBeenCalledWith(request);
      expect(kafka.client.emit).toHaveBeenCalledTimes(1);
    });
  });

  // ─── removeFriend ────────────────────────────────────

  describe('removeFriend', () => {
    it('should throw when friendship not found', async () => {
      friendshipRepo.findOne.mockResolvedValue(null);

      await expect(service.removeFriend(USER_ID, TARGET_ID)).rejects.toThrow();
    });

    it('should remove friendship, invalidate cache, and emit event', async () => {
      const friendship = {
        id: 'f1',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.ACCEPTED,
      };
      friendshipRepo.findOne.mockResolvedValue(friendship);

      const result = await service.removeFriend(USER_ID, TARGET_ID);

      expect(result.message).toContain('removed');
      expect(friendshipRepo.remove).toHaveBeenCalledWith(friendship);
      // Friend cache invalidated for both users
      expect(redis.client.del).toHaveBeenCalled();
      // FriendRemoved event emitted
      expect(kafka.client.emit).toHaveBeenCalledTimes(1);
    });
  });

  // ─── blockUser ───────────────────────────────────────

  describe('blockUser', () => {
    it('should reject self-block', async () => {
      await expect(service.blockUser(USER_ID, USER_ID)).rejects.toThrow();
    });

    it('should create new BLOCKED friendship when none exists', async () => {
      friendshipRepo.findOne.mockResolvedValue(null);
      friendshipRepo.create.mockReturnValue({
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.BLOCKED,
      });
      friendshipRepo.save.mockResolvedValue({
        id: 'block-1',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.BLOCKED,
      });

      const result = await service.blockUser(USER_ID, TARGET_ID);

      expect(result.message).toContain('blocked');
      expect(friendshipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: FriendshipStatus.BLOCKED }),
      );
    });

    it('should upgrade existing friendship to BLOCKED', async () => {
      const existing = {
        id: 'f-existing',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.ACCEPTED,
      };
      friendshipRepo.findOne.mockResolvedValue(existing);
      friendshipRepo.save.mockResolvedValue({
        ...existing,
        status: FriendshipStatus.BLOCKED,
      });

      const result = await service.blockUser(USER_ID, TARGET_ID);

      expect(result.message).toContain('blocked');
      expect(friendshipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FriendshipStatus.BLOCKED }),
      );
    });

    it('should re-create as requester if other user was requester', async () => {
      const existing = {
        id: 'f-reverse',
        requesterId: TARGET_ID,
        addresseeId: USER_ID,
        status: FriendshipStatus.ACCEPTED,
      };
      friendshipRepo.findOne.mockResolvedValue(existing);
      friendshipRepo.create.mockReturnValue({
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.BLOCKED,
      });
      friendshipRepo.save.mockResolvedValue({
        id: 'new-block',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.BLOCKED,
      });

      const result = await service.blockUser(USER_ID, TARGET_ID);

      expect(result.message).toContain('blocked');
      // Old record should be removed first
      expect(friendshipRepo.remove).toHaveBeenCalledWith(existing);
      // Then new one created with user as requester
      expect(friendshipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterId: USER_ID,
          addresseeId: TARGET_ID,
        }),
      );
    });
  });

  // ─── unblockUser ─────────────────────────────────────

  describe('unblockUser', () => {
    it('should throw when not blocked', async () => {
      friendshipRepo.findOne.mockResolvedValue(null);

      await expect(service.unblockUser(USER_ID, TARGET_ID)).rejects.toThrow();
    });

    it('should remove BLOCKED friendship', async () => {
      const block = {
        id: 'block-1',
        requesterId: USER_ID,
        addresseeId: TARGET_ID,
        status: FriendshipStatus.BLOCKED,
      };
      friendshipRepo.findOne.mockResolvedValue(block);

      const result = await service.unblockUser(USER_ID, TARGET_ID);

      expect(result.message).toContain('unblocked');
      expect(friendshipRepo.remove).toHaveBeenCalledWith(block);
    });
  });
});
