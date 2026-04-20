import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FriendshipAccessService } from './friendship-access.service';
import { Friendship } from '@libs/database/entities';
import { CacheService } from '@libs/redis';
import { FriendshipStatus } from '@app/constant/enum';

describe('FriendshipAccessService', () => {
  const friendshipRepo = {
    exists: jest.fn<Promise<boolean>, [unknown]>(),
    find: jest.fn<
      Promise<Array<{ requesterId: string; addresseeId: string }>>,
      [unknown]
    >(),
  };

  const cacheService = {
    get: jest.fn<Promise<boolean | null>, [string]>(),
    set: jest.fn<Promise<void>, [string, boolean, number]>(),
  };

  let service: FriendshipAccessService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendshipAccessService,
        {
          provide: getRepositoryToken(Friendship),
          useValue: friendshipRepo,
        },
        {
          provide: CacheService,
          useValue: cacheService,
        },
      ],
    }).compile();

    service = module.get(FriendshipAccessService);
  });

  describe('getFriendSet', () => {
    it('should include self, cached friends, and DB-discovered friends', async () => {
      cacheService.get.mockResolvedValueOnce(null).mockResolvedValueOnce(true);
      friendshipRepo.find.mockResolvedValue([
        {
          requesterId: 'reference-user',
          addresseeId: 'db-friend',
        },
      ]);
      cacheService.set.mockResolvedValue();

      const result = await service.getFriendSet('reference-user', [
        'reference-user',
        'db-friend',
        'cached-friend',
      ]);

      expect(result).toEqual(
        new Set(['reference-user', 'db-friend', 'cached-friend']),
      );
      expect(friendshipRepo.find).toHaveBeenCalledTimes(1);
      const [[findQuery]] = friendshipRepo.find.mock.calls as Array<
        [
          {
            where: Array<{
              requesterId: string | { _type?: string };
              addresseeId: string | { _type?: string };
              status: FriendshipStatus;
            }>;
            select: { requesterId: boolean; addresseeId: boolean };
          },
        ]
      >;
      expect(findQuery.where).toHaveLength(2);
      expect(findQuery.where[0].requesterId).toBe('reference-user');
      expect(findQuery.where[0].status).toBe(FriendshipStatus.ACCEPTED);
      expect(findQuery.where[1].addresseeId).toBe('reference-user');
      expect(findQuery.where[1].status).toBe(FriendshipStatus.ACCEPTED);
      expect(findQuery.select).toEqual({
        requesterId: true,
        addresseeId: true,
      });
      expect(cacheService.set).toHaveBeenCalledWith(
        'friendship:pair:db-friend:reference-user',
        true,
        120,
      );
    });

    it('should return empty set when candidateIds is empty', async () => {
      const result = await service.getFriendSet('reference-user', []);

      expect(result.size).toBe(0);
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(friendshipRepo.find).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('areFriends', () => {
    it('should read from cache and skip DB query when cache is present', async () => {
      cacheService.get.mockResolvedValue(true);

      const result = await service.areFriends('user-a', 'user-b');

      expect(result).toBe(true);
      expect(friendshipRepo.exists).not.toHaveBeenCalled();
    });
  });
});
