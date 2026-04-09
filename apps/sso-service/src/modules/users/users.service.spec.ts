/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file users.service.spec.ts (SSO)
 *
 * Unit tests for SSO UsersService — covers profile CRUD, search,
 * cache integration, blocking logic, and phone masking.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User, Friendship, MediaFile } from '@libs/database/entities';
import { CacheService } from '@libs/redis';

// Mock constants
const UserStatus = { ACTIVE: 'active', INACTIVE: 'inactive' };

// Helpers
const createMockUser = (overrides: Record<string, any> = {}) => ({
  id: 'user-1',
  phone: '+84901234567',
  email: 'test@example.com',
  fullName: 'Test User',
  avatarUrl: 'https://cdn.example.com/avatar.jpg',
  bio: 'Hello world',
  gender: 'male',
  dateOfBirth: new Date('1995-06-15'),
  status: UserStatus.ACTIVE,
  createdAt: new Date('2024-01-01'),
  lastSeenAt: new Date(),
  ...overrides,
});

describe('SSO UsersService', () => {
  let service: UsersService;
  let userRepository: Record<string, jest.Mock>;
  let friendshipRepository: Record<string, jest.Mock>;
  let mediaFileRepository: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };

    friendshipRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mediaFileRepository = {
      findOne: jest.fn(),
    };

    cacheService = {
      getUserProfile: jest.fn().mockResolvedValue(null),
      setUserProfile: jest.fn().mockResolvedValue(undefined),
      getUserPublic: jest.fn().mockResolvedValue(null),
      setUserPublic: jest.fn().mockResolvedValue(undefined),
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Friendship),
          useValue: friendshipRepository,
        },
        {
          provide: getRepositoryToken(MediaFile),
          useValue: mediaFileRepository,
        },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    // Inject mocks manually since @InjectRepository uses tokens
    (service as any).userRepository = userRepository;
    (service as any).friendshipRepository = friendshipRepository;
    (service as any).mediaFileRepo = mediaFileRepository;
    (service as any).cacheService = cacheService;
  });

  // ─── getMyProfile ───────────────────────────────────────

  describe('getMyProfile', () => {
    it('should return cached profile if available', async () => {
      const cached = { id: 'user-1', fullName: 'Cached User' };
      cacheService.getUserProfile.mockResolvedValue(cached);

      const result = await service.getMyProfile('user-1');

      expect(cacheService.getUserProfile).toHaveBeenCalledWith('user-1');
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query DB on cache miss and cache the result', async () => {
      const mockUser = createMockUser();
      cacheService.getUserProfile.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getMyProfile('user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(cacheService.setUserProfile).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          id: 'user-1',
          fullName: 'Test User',
          phone: '+84901234567',
        }),
      );
      expect(result.id).toBe('user-1');
      expect(result.fullName).toBe('Test User');
    });

    it('should throw BusinessException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getMyProfile('nonexistent')).rejects.toThrow();
    });
  });

  // ─── updateMyProfile ───────────────────────────────────

  describe('updateMyProfile', () => {
    it('should update profile fields and invalidate cache', async () => {
      const mockUser = createMockUser();
      userRepository.findOne
        .mockResolvedValueOnce(mockUser) // first findOne
        .mockResolvedValueOnce({ ...mockUser, fullName: 'New Name' }); // after update

      const result = await service.updateMyProfile('user-1', {
        fullName: 'New Name',
      } as any);

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        fullName: 'New Name',
      });
      expect(cacheService.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(result.fullName).toBe('New Name');
    });

    it('should throw when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateMyProfile('nonexistent', { fullName: 'Test' } as any),
      ).rejects.toThrow();
    });

    it('should check email uniqueness when email changes', async () => {
      const mockUser = createMockUser({ email: 'old@example.com' });
      userRepository.findOne
        .mockResolvedValueOnce(mockUser) // current user
        .mockResolvedValueOnce({ id: 'other-user' }); // email exists

      await expect(
        service.updateMyProfile('user-1', {
          email: 'taken@example.com',
        } as any),
      ).rejects.toThrow();
    });

    it('should allow email update when email is not taken', async () => {
      const mockUser = createMockUser({ email: 'old@example.com' });
      userRepository.findOne
        .mockResolvedValueOnce(mockUser) // current user
        .mockResolvedValueOnce(null) // email not taken
        .mockResolvedValueOnce({ ...mockUser, email: 'new@example.com' }); // after update

      await service.updateMyProfile('user-1', {
        email: 'new@example.com',
      } as any);

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          email: 'new@example.com',
        }),
      );
    });

    it('should skip email check when email is unchanged', async () => {
      const mockUser = createMockUser({ email: 'same@example.com' });
      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ ...mockUser, fullName: 'New' });

      await service.updateMyProfile('user-1', {
        email: 'same@example.com',
        fullName: 'New',
      } as any);

      // findOne called only twice: (1) get user, (2) reload after update
      // Not a third time for email check since email is same
      expect(userRepository.findOne).toHaveBeenCalledTimes(2);
    });

    it('should handle dateOfBirth conversion', async () => {
      const mockUser = createMockUser();
      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockUser);

      await service.updateMyProfile('user-1', {
        dateOfBirth: '2000-01-01',
      } as any);

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          dateOfBirth: expect.any(Date),
        }),
      );
    });

    it('should only update provided fields (partial update)', async () => {
      const mockUser = createMockUser();
      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockUser);

      await service.updateMyProfile('user-1', { bio: 'New bio' } as any);

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        bio: 'New bio',
      });
    });
  });

  // ─── getUserById ────────────────────────────────────────

  describe('getUserById', () => {
    it('should return cached public profile if not blocked', async () => {
      const cached = { id: 'user-2', fullName: 'Cached Public' };
      cacheService.getUserPublic.mockResolvedValue(cached);
      friendshipRepository.findOne.mockResolvedValue(null); // not blocked

      const result = await service.getUserById('user-2', 'current-user');

      expect(cacheService.getUserPublic).toHaveBeenCalledWith('user-2');
      expect(result).toEqual(cached);
    });

    it('should throw when user is blocked (cached path)', async () => {
      const cached = { id: 'user-2', fullName: 'Blocked User' };
      cacheService.getUserPublic.mockResolvedValue(cached);
      friendshipRepository.findOne.mockResolvedValue({ status: 'blocked' }); // blocked

      await expect(
        service.getUserById('user-2', 'current-user'),
      ).rejects.toThrow();
    });

    it('should query DB on cache miss and cache public profile', async () => {
      const mockUser = createMockUser({ id: 'user-2' });
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);
      friendshipRepository.findOne.mockResolvedValue(null);

      const result = await service.getUserById('user-2', 'current-user');

      expect(cacheService.setUserPublic).toHaveBeenCalledWith(
        'user-2',
        expect.objectContaining({
          id: 'user-2',
          fullName: 'Test User',
        }),
      );
      expect(result.id).toBe('user-2');
    });

    it('should throw when user not found', async () => {
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getUserById('nonexistent', 'current'),
      ).rejects.toThrow();
    });

    it('should throw when user is inactive', async () => {
      const inactiveUser = createMockUser({ id: 'user-2', status: 'inactive' });
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(inactiveUser);

      await expect(service.getUserById('user-2', 'current')).rejects.toThrow();
    });

    it('should throw when user is blocked (DB path)', async () => {
      const mockUser = createMockUser({ id: 'user-2' });
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);
      friendshipRepository.findOne.mockResolvedValue({ status: 'blocked' });

      await expect(service.getUserById('user-2', 'current')).rejects.toThrow();
    });

    it('should check only blocks FROM target user TO current user', async () => {
      const mockUser = createMockUser({ id: 'target-user' });
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);
      friendshipRepository.findOne.mockResolvedValue(null);

      await service.getUserById('target-user', 'me');

      // Verify the WHERE clause checks target->me direction for blocking
      expect(friendshipRepository.findOne).toHaveBeenCalledWith({
        where: expect.arrayContaining([
          expect.objectContaining({
            requesterId: 'target-user',
            addresseeId: 'me',
          }),
        ]),
      });
    });
  });

  // ─── searchUsers ────────────────────────────────────────

  describe('searchUsers', () => {
    it('should search by name/phone excluding current user', async () => {
      const mockUsers = [
        createMockUser({ id: 'user-2', fullName: 'Nguyen Van B' }),
      ];

      userRepository.findAndCount.mockResolvedValue([mockUsers, 1]);

      // Mock friendship query builder
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'Nguyen', page: 1, limit: 20 } as any,
        'current-user',
      );

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should return empty results when no match', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'NonExistent', page: 1, limit: 20 } as any,
        'current-user',
      );

      expect(result.items).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('should cap limit at 50', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'test', page: 1, limit: 200 } as any,
        'current-user',
      );

      // limit capped at 50
      expect(result.meta.limit).toBe(50);
    });

    it('should include friendship status in results', async () => {
      const mockUsers = [
        createMockUser({ id: 'friend-user', fullName: 'Friend' }),
      ];
      userRepository.findAndCount.mockResolvedValue([mockUsers, 1]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            requesterId: 'current-user',
            addresseeId: 'friend-user',
            status: 'accepted',
          },
        ]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'Friend', page: 1, limit: 20 } as any,
        'current-user',
      );

      expect(result.items[0].friendshipStatus).toBe('friends');
    });

    it('should correctly set pagination meta hasNext/hasPrev', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 100]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'test', page: 2, limit: 20 } as any,
        'current-user',
      );

      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(true);
      expect(result.meta.totalPages).toBe(5);
    });

    it('should mask phone numbers in search results', async () => {
      const mockUsers = [
        createMockUser({ id: 'user-x', phone: '+84901234567' }),
      ];
      userRepository.findAndCount.mockResolvedValue([mockUsers, 1]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'test', page: 1, limit: 20 } as any,
        'current-user',
      );

      // Phone should be masked: +84***234567
      expect(result.items[0].phone).toMatch(/\*{3}/);
      expect(result.items[0].phone).not.toBe('+84901234567');
    });

    it('should show pending_sent for outgoing pending request', async () => {
      const mockUsers = [createMockUser({ id: 'target-user' })];
      userRepository.findAndCount.mockResolvedValue([mockUsers, 1]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            requesterId: 'current-user',
            addresseeId: 'target-user',
            status: 'pending',
          },
        ]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'test', page: 1, limit: 20 } as any,
        'current-user',
      );

      expect(result.items[0].friendshipStatus).toBe('pending_sent');
    });

    it('should show pending_received for incoming pending request', async () => {
      const mockUsers = [createMockUser({ id: 'requester-user' })];
      userRepository.findAndCount.mockResolvedValue([mockUsers, 1]);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            requesterId: 'requester-user',
            addresseeId: 'current-user',
            status: 'pending',
          },
        ]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.searchUsers(
        { q: 'test', page: 1, limit: 20 } as any,
        'current-user',
      );

      expect(result.items[0].friendshipStatus).toBe('pending_received');
    });
  });

  // ─── Profile response mapping ──────────────────────────

  describe('profile response mapping', () => {
    it('should map user entity to profile response correctly', async () => {
      const mockUser = createMockUser();
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getMyProfile('user-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-1',
          phone: '+84901234567',
          email: 'test@example.com',
          fullName: 'Test User',
          avatarUrl: 'https://cdn.example.com/avatar.jpg',
          bio: 'Hello world',
          gender: 'male',
          status: UserStatus.ACTIVE,
        }),
      );
    });

    it('should map user to public response (no email/phone)', async () => {
      const mockUser = createMockUser({ id: 'user-2' });
      cacheService.getUserPublic.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);
      friendshipRepository.findOne.mockResolvedValue(null);

      const result = await service.getUserById('user-2', 'other');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-2',
          fullName: 'Test User',
          avatarUrl: expect.any(String),
          bio: 'Hello world',
          status: UserStatus.ACTIVE,
        }),
      );
      // Public profile should NOT expose email or phone
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('phone');
    });
  });
});
