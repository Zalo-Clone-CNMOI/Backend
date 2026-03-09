/**
 * @file users.service.integration.spec.ts
 *
 * Integration tests for UsersService (SSO) with real NestJS DI.
 * TypeORM repositories are mocked at interface level.
 * CacheService uses in-memory Redis mock.
 *
 * Covers:
 *  - getMyProfile (cache hit, cache miss, not found)
 *  - updateMyProfile (success, email conflict)
 *  - getUserById (cache hit, blocked user, inactive user)
 *  - searchUsers (pagination, friendship status mapping)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../../../apps/sso-service/src/modules/users/users.service';
import { User, Friendship } from '@libs/database';
import { CacheService } from '@libs/redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import {
  createMockRepository,
  createMockQueryBuilder,
} from '../../helpers/test-database.helper';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';
import { makeUserProfile } from '../../helpers/test-fixtures';
import { UserStatus, FriendshipStatus } from '@app/constant';

describe('UsersService (integration)', () => {
  let module: TestingModule;
  let service: UsersService;
  let userRepo: ReturnType<typeof createMockRepository>;
  let friendshipRepo: ReturnType<typeof createMockRepository>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let cache: CacheService;

  beforeAll(async () => {
    userRepo = createMockRepository();
    friendshipRepo = createMockRepository();
    redis = createMockRedisClient();

    module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Friendship), useValue: friendshipRepo },
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis.client },
      ],
    }).compile();

    service = module.get(UsersService);
    cache = module.get(CacheService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    redis.reset();
    jest.clearAllMocks();
  });

  // ─── getMyProfile ────────────────────────────────────

  describe('getMyProfile', () => {
    it('should return cached profile on cache hit', async () => {
      const profile = makeUserProfile({ id: 'user-1' });
      await cache.setUserProfile('user-1', profile);

      const result = await service.getMyProfile('user-1');

      expect(result).toEqual(profile);
      // Should NOT call userRepo.findOne (cache hit)
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache on miss', async () => {
      const dbUser = {
        id: 'user-2',
        phone: '+84901234567',
        email: null,
        fullName: 'DB User',
        avatarUrl: null,
        bio: null,
        gender: null,
        dateOfBirth: null,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        passwordHash: 'hash',
      };
      userRepo.findOne.mockResolvedValue(dbUser);

      const result = await service.getMyProfile('user-2');

      expect(result.id).toBe('user-2');
      expect(result.fullName).toBe('DB User');
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'user-2' },
      });

      // Should now be cached
      const cached = await cache.getUserProfile<typeof result>('user-2');
      expect(cached).not.toBeNull();
      expect(cached!.id).toBe('user-2');
    });

    it('should throw BusinessException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getMyProfile('non-existent')).rejects.toThrow();
    });
  });

  // ─── updateMyProfile ─────────────────────────────────

  describe('updateMyProfile', () => {
    const existingUser = {
      id: 'user-upd',
      phone: '+84901234567',
      email: null,
      fullName: 'Old Name',
      avatarUrl: null,
      bio: null,
      gender: null,
      dateOfBirth: null,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      passwordHash: 'hash',
    };

    it('should update profile and invalidate cache', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(existingUser) // find user
        .mockResolvedValueOnce({ ...existingUser, fullName: 'New Name' }); // reload after update

      const result = await service.updateMyProfile('user-upd', {
        fullName: 'New Name',
      });

      expect(result.fullName).toBe('New Name');
      expect(userRepo.update).toHaveBeenCalledWith('user-upd', {
        fullName: 'New Name',
      });

      // Cache should have been invalidated via CacheService.invalidateUser
      expect(redis.client.del).toHaveBeenCalled();
    });

    it('should allow updating email when not taken', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(existingUser) // find user
        .mockResolvedValueOnce(null) // email uniqueness check → not taken
        .mockResolvedValueOnce({ ...existingUser, email: 'new@example.com' }); // reload

      const result = await service.updateMyProfile('user-upd', {
        email: 'new@example.com',
      });

      expect(result.email).toBe('new@example.com');
      expect(userRepo.update).toHaveBeenCalledWith('user-upd', {
        email: 'new@example.com',
      });
    });

    it('should reject duplicate email', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(existingUser) // find user
        .mockResolvedValueOnce({
          id: 'other-user',
          email: 'taken@example.com',
        }); // email check → taken

      await expect(
        service.updateMyProfile('user-upd', {
          email: 'taken@example.com',
        }),
      ).rejects.toThrow();
    });

    it('should throw when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateMyProfile('missing', { fullName: 'X' }),
      ).rejects.toThrow();
    });
  });

  // ─── getUserById ──────────────────────────────────────

  describe('getUserById', () => {
    it('should return cached public profile', async () => {
      const publicProfile = {
        id: 'u1',
        fullName: 'Public User',
        avatarUrl: null,
        bio: null,
        status: UserStatus.ACTIVE,
      };
      await cache.setUserPublic('u1', publicProfile);
      friendshipRepo.findOne.mockResolvedValue(null); // not blocked

      const result = await service.getUserById('u1', 'current-user');

      expect(result).toEqual(publicProfile);
    });

    it('should throw if user blocked the current user', async () => {
      const publicProfile = {
        id: 'blocker',
        fullName: 'Blocker',
        avatarUrl: null,
        bio: null,
        status: UserStatus.ACTIVE,
      };
      await cache.setUserPublic('blocker', publicProfile);
      friendshipRepo.findOne.mockResolvedValue({
        requesterId: 'blocker',
        addresseeId: 'current-user',
        status: FriendshipStatus.BLOCKED,
      });

      await expect(
        service.getUserById('blocker', 'current-user'),
      ).rejects.toThrow();
    });

    it('should throw for inactive user', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'inactive',
        status: UserStatus.INACTIVE,
        fullName: 'Gone',
      });

      await expect(
        service.getUserById('inactive', 'current-user'),
      ).rejects.toThrow();
    });

    it('should throw for non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getUserById('ghost', 'current-user'),
      ).rejects.toThrow();
    });
  });

  // ─── searchUsers ──────────────────────────────────────

  describe('searchUsers', () => {
    it('should return paginated search results', async () => {
      const users = [
        {
          id: 'u1',
          fullName: 'Alice',
          avatarUrl: null,
          phone: '+84901234567',
          status: UserStatus.ACTIVE,
        },
        {
          id: 'u2',
          fullName: 'Alibaba',
          avatarUrl: null,
          phone: '+84907654321',
          status: UserStatus.ACTIVE,
        },
      ];

      userRepo.findAndCount.mockResolvedValue([users, 2]);

      // No friendships
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchUsers(
        { q: 'Ali', page: 1, limit: 20 },
        'current-user',
      );

      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.items[0].friendshipStatus).toBe('none');
    });

    it('should map friendship statuses correctly', async () => {
      const users = [
        {
          id: 'friend-user',
          fullName: 'Friend',
          avatarUrl: null,
          phone: '+84900000001',
          status: UserStatus.ACTIVE,
        },
      ];
      userRepo.findAndCount.mockResolvedValue([users, 1]);

      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([
        {
          requesterId: 'current-user',
          addresseeId: 'friend-user',
          status: FriendshipStatus.ACCEPTED,
        },
      ]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchUsers(
        { q: 'Friend', page: 1, limit: 20 },
        'current-user',
      );

      expect(result.items[0].friendshipStatus).toBe('friends');
    });

    it('should respect pagination limits', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      friendshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchUsers(
        { q: 'test', page: 2, limit: 5 },
        'current-user',
      );

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(5);
    });
  });
});
