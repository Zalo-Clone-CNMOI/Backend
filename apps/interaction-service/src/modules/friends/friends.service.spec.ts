/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file friends.service.spec.ts (interaction-service)
 *
 * Unit tests for FriendsService — friend request lifecycle,
 * block/unblock, Kafka events, cache invalidation, and error cases.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FriendsService } from './friends.service';
import { User, Friendship } from '@libs/database/entities';
import { CacheService } from '@libs/redis';
import { KAFKA_CLIENT } from '@libs/kafka';
import { RespondFriendRequestDtoActionEnum } from './dto';

// ─── Mock Enums ──────────────────────────────────────────
const FriendshipStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  BLOCKED: 'blocked',
};
const UserStatus = { ACTIVE: 'active', INACTIVE: 'inactive' };

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

const createMockFriendship = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(9),
  requesterId: uuid(1),
  addresseeId: uuid(2),
  status: FriendshipStatus.PENDING,
  createdAt: new Date(),
  updatedAt: new Date(),
  requester: {
    id: uuid(1),
    fullName: 'Requester',
    avatarUrl: null,
    phone: '0123456789',
  },
  addressee: {
    id: uuid(2),
    fullName: 'Addressee',
    avatarUrl: null,
    phone: '0987654321',
  },
  ...overrides,
});

describe('FriendsService', () => {
  let service: FriendsService;
  let userRepository: Record<string, jest.Mock>;
  let friendshipRepository: Record<string, jest.Mock>;
  let kafkaClient: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
    };

    friendshipRepository = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      find: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: uuid(9) })),
      save: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ ...data, id: data.id || uuid(9) }),
        ),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };

    kafkaClient = {
      emit: jest.fn(),
    };

    cacheService = {
      invalidateFriendLists: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Friendship),
          useValue: friendshipRepository,
        },
        { provide: KAFKA_CLIENT, useValue: kafkaClient },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
  });

  // ─── getFriends ─────────────────────────────────────────

  describe('getFriends', () => {
    it('should return paginated list of friends', async () => {
      const friendship = createMockFriendship({
        status: FriendshipStatus.ACCEPTED,
      });
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[friendship], 1]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getFriends(uuid(1), {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.items[0].fullName).toBe('Addressee'); // other user
    });

    it('should cap limit at 50', async () => {
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      friendshipRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getFriends(uuid(1), {
        page: 1,
        limit: 200,
      });

      expect(result.meta.limit).toBe(50);
    });
  });

  // ─── getPendingRequests ─────────────────────────────────

  describe('getPendingRequests', () => {
    it('should return pending received requests', async () => {
      const req = createMockFriendship({ addresseeId: uuid(2) });
      friendshipRepository.findAndCount.mockResolvedValue([[req], 1]);

      const result = await service.getPendingRequests(uuid(2), {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].user.id).toBe(uuid(1)); // requester
    });
  });

  // ─── getSentRequests ────────────────────────────────────

  describe('getSentRequests', () => {
    it('should return sent pending requests', async () => {
      const req = createMockFriendship({ requesterId: uuid(1) });
      friendshipRepository.findAndCount.mockResolvedValue([[req], 1]);

      const result = await service.getSentRequests(uuid(1), {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].user.id).toBe(uuid(2)); // addressee
    });
  });

  // ─── sendFriendRequest ──────────────────────────────────

  describe('sendFriendRequest', () => {
    it('should throw when adding yourself', async () => {
      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(1) }),
      ).rejects.toThrow();
    });

    it('should throw when target user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(2) }),
      ).rejects.toThrow();
    });

    it('should throw when target user inactive', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: uuid(2),
        status: UserStatus.INACTIVE,
      });

      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(2) }),
      ).rejects.toThrow();
    });

    it('should throw when already friends', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: uuid(2),
        status: UserStatus.ACTIVE,
      });
      friendshipRepository.findOne.mockResolvedValue(
        createMockFriendship({ status: FriendshipStatus.ACCEPTED }),
      );

      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(2) }),
      ).rejects.toThrow();
    });

    it('should throw when request already pending', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: uuid(2),
        status: UserStatus.ACTIVE,
      });
      friendshipRepository.findOne.mockResolvedValue(
        createMockFriendship({ status: FriendshipStatus.PENDING }),
      );

      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(2) }),
      ).rejects.toThrow();
    });

    it('should throw when user is blocked', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: uuid(2),
        status: UserStatus.ACTIVE,
      });
      friendshipRepository.findOne.mockResolvedValue(
        createMockFriendship({ status: FriendshipStatus.BLOCKED }),
      );

      await expect(
        service.sendFriendRequest(uuid(1), { userId: uuid(2) }),
      ).rejects.toThrow();
    });

    it('should create request and emit Kafka event', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: uuid(2), status: UserStatus.ACTIVE }) // target user
        .mockResolvedValueOnce({
          id: uuid(1),
          fullName: 'Requester',
          avatarUrl: null,
          phone: '123',
        }); // requester fetch

      friendshipRepository.findOne.mockResolvedValue(null); // no existing
      friendshipRepository.save.mockResolvedValue({ id: uuid(9) });

      const result = await service.sendFriendRequest(uuid(1), {
        userId: uuid(2),
      });

      expect(result.message).toContain('sent');
      expect(result.requestId).toBe(uuid(9));
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'friend.request.send',
        expect.objectContaining({
          requesterId: uuid(1),
          addresseeId: uuid(2),
        }),
      );
    });
  });

  // ─── respondToRequest ───────────────────────────────────

  describe('respondToRequest', () => {
    it('should throw when request not found', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(
        service.respondToRequest(uuid(2), 'nonexistent', {
          action: RespondFriendRequestDtoActionEnum.accept,
        }),
      ).rejects.toThrow();
    });

    it('should accept and invalidate cache + emit Kafka', async () => {
      const req = createMockFriendship();
      friendshipRepository.findOne.mockResolvedValue(req);
      userRepository.findOne.mockResolvedValue({
        id: uuid(2),
        fullName: 'Addressee',
        avatarUrl: null,
      });

      const result = await service.respondToRequest(uuid(2), uuid(9), {
        action: RespondFriendRequestDtoActionEnum.accept,
      });

      expect(result.message).toContain('accepted');
      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FriendshipStatus.ACCEPTED }),
      );
      expect(cacheService.invalidateFriendLists).toHaveBeenCalledWith([
        uuid(1),
        uuid(2),
      ]);
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'friend.request.respond',
        expect.objectContaining({ status: 'accepted' }),
      );
    });

    it('should reject and remove record + emit Kafka', async () => {
      const req = createMockFriendship();
      friendshipRepository.findOne.mockResolvedValue(req);

      const result = await service.respondToRequest(uuid(2), uuid(9), {
        action: RespondFriendRequestDtoActionEnum.reject,
      });

      expect(result.message).toContain('rejected');
      expect(friendshipRepository.remove).toHaveBeenCalledWith(req);
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'friend.request.respond',
        expect.objectContaining({ status: 'rejected' }),
      );
    });

    it('should reject if request is not PENDING', async () => {
      friendshipRepository.findOne.mockResolvedValue(
        createMockFriendship({ status: FriendshipStatus.ACCEPTED }),
      );

      await expect(
        service.respondToRequest(uuid(2), uuid(9), {
          action: RespondFriendRequestDtoActionEnum.accept,
        }),
      ).rejects.toThrow();
    });
  });

  // ─── cancelRequest ──────────────────────────────────────

  describe('cancelRequest', () => {
    it('should cancel and emit Kafka event', async () => {
      const req = createMockFriendship();
      friendshipRepository.findOne.mockResolvedValue(req);

      const result = await service.cancelRequest(uuid(1), uuid(9));

      expect(result.message).toContain('cancelled');
      expect(friendshipRepository.remove).toHaveBeenCalledWith(req);
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'friend.request.cancelled',
        expect.objectContaining({ requesterId: uuid(1) }),
      );
    });

    it('should throw when request not found', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(
        service.cancelRequest(uuid(1), 'nonexistent'),
      ).rejects.toThrow();
    });
  });

  // ─── removeFriend ───────────────────────────────────────

  describe('removeFriend', () => {
    it('should remove accepted friendship and emit Kafka', async () => {
      const friendship = createMockFriendship({
        status: FriendshipStatus.ACCEPTED,
      });
      friendshipRepository.findOne.mockResolvedValue(friendship);

      const result = await service.removeFriend(uuid(1), uuid(2));

      expect(result.message).toContain('removed');
      expect(friendshipRepository.remove).toHaveBeenCalled();
      expect(cacheService.invalidateFriendLists).toHaveBeenCalledWith([
        uuid(1),
        uuid(2),
      ]);
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'friend.removed',
        expect.objectContaining({ userId: uuid(1), friendId: uuid(2) }),
      );
    });

    it('should throw when not friends', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(service.removeFriend(uuid(1), uuid(2))).rejects.toThrow();
    });
  });

  // ─── blockUser ──────────────────────────────────────────

  describe('blockUser', () => {
    it('should throw when blocking yourself', async () => {
      await expect(service.blockUser(uuid(1), uuid(1))).rejects.toThrow();
    });

    it('should create BLOCKED friendship when none exists', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      const result = await service.blockUser(uuid(1), uuid(2));

      expect(result.message).toContain('blocked');
      expect(friendshipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterId: uuid(1),
          addresseeId: uuid(2),
          status: FriendshipStatus.BLOCKED,
        }),
      );
      expect(friendshipRepository.save).toHaveBeenCalled();
    });

    it('should update existing friendship to BLOCKED (same direction)', async () => {
      const existing = createMockFriendship({
        requesterId: uuid(1),
        addresseeId: uuid(2),
        status: FriendshipStatus.ACCEPTED,
      });
      friendshipRepository.findOne.mockResolvedValue(existing);

      await service.blockUser(uuid(1), uuid(2));

      expect(friendshipRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FriendshipStatus.BLOCKED }),
      );
    });

    it('should re-create when blocking from reverse direction', async () => {
      const existing = createMockFriendship({
        requesterId: uuid(2), // other direction
        addresseeId: uuid(1),
        status: FriendshipStatus.ACCEPTED,
      });
      friendshipRepository.findOne.mockResolvedValue(existing);

      await service.blockUser(uuid(1), uuid(2));

      expect(friendshipRepository.remove).toHaveBeenCalledWith(existing);
      expect(friendshipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterId: uuid(1),
          addresseeId: uuid(2),
          status: FriendshipStatus.BLOCKED,
        }),
      );
    });
  });

  // ─── unblockUser ────────────────────────────────────────

  describe('unblockUser', () => {
    it('should remove blocked friendship', async () => {
      const blocked = createMockFriendship({
        status: FriendshipStatus.BLOCKED,
      });
      friendshipRepository.findOne.mockResolvedValue(blocked);

      const result = await service.unblockUser(uuid(1), uuid(2));

      expect(result.message).toContain('unblocked');
      expect(friendshipRepository.remove).toHaveBeenCalledWith(blocked);
    });

    it('should throw when block relationship not found', async () => {
      friendshipRepository.findOne.mockResolvedValue(null);

      await expect(service.unblockUser(uuid(1), uuid(2))).rejects.toThrow();
    });
  });
});
