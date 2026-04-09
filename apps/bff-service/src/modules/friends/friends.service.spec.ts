/**
 * @file friends.service.spec.ts (BFF)
 *
 * Unit tests for BFF FriendsService — verifies all proxy delegations
 * to InteractionClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service';
import { InteractionClientService } from '@app/clients/interaction-client';

describe('BFF FriendsService', () => {
  let service: FriendsService;
  let interactionClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    interactionClient = {
      getFriends: jest.fn(),
      getPendingRequests: jest.fn(),
      getSentRequests: jest.fn(),
      sendFriendRequest: jest.fn(),
      respondToRequest: jest.fn(),
      cancelRequest: jest.fn(),
      removeFriend: jest.fn(),
      blockUser: jest.fn(),
      unblockUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: InteractionClientService, useValue: interactionClient },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    (service as unknown).interactionClient = interactionClient;
  });

  describe('getFriends', () => {
    it('should delegate to interactionClient.getFriends', async () => {
      const expected = { items: [], meta: { total: 0 } };
      interactionClient.getFriends.mockResolvedValue(expected);

      const result = await service.getFriends('token', 1, 20);

      expect(interactionClient.getFriends).toHaveBeenCalledWith('token', 1, 20);
      expect(result).toEqual(expected);
    });
  });

  describe('getPendingRequests', () => {
    it('should delegate to interactionClient.getPendingRequests', async () => {
      interactionClient.getPendingRequests.mockResolvedValue({ items: [] });

      await service.getPendingRequests('token', 1, 10);

      expect(interactionClient.getPendingRequests).toHaveBeenCalledWith(
        'token',
        1,
        10,
      );
    });
  });

  describe('getSentRequests', () => {
    it('should delegate to interactionClient.getSentRequests', async () => {
      interactionClient.getSentRequests.mockResolvedValue({ items: [] });

      await service.getSentRequests('token', 2, 15);

      expect(interactionClient.getSentRequests).toHaveBeenCalledWith(
        'token',
        2,
        15,
      );
    });
  });

  describe('sendFriendRequest', () => {
    it('should delegate to interactionClient.sendFriendRequest', async () => {
      const dto = { userId: 'target-uuid', message: 'Hello' };
      interactionClient.sendFriendRequest.mockResolvedValue({
        message: 'Sent',
      });

      await service.sendFriendRequest('token', dto as unknown);

      expect(interactionClient.sendFriendRequest).toHaveBeenCalledWith(
        'token',
        dto,
      );
    });
  });

  describe('respondToRequest', () => {
    it('should delegate to interactionClient.respondToRequest', async () => {
      const dto = { action: 'accept' };
      interactionClient.respondToRequest.mockResolvedValue({
        message: 'Accepted',
      });

      await service.respondToRequest('token', 'req-uuid', dto as unknown);

      expect(interactionClient.respondToRequest).toHaveBeenCalledWith(
        'token',
        'req-uuid',
        dto,
      );
    });
  });

  describe('cancelRequest', () => {
    it('should delegate to interactionClient.cancelRequest', async () => {
      interactionClient.cancelRequest.mockResolvedValue({
        message: 'Cancelled',
      });

      await service.cancelRequest('token', 'req-uuid');

      expect(interactionClient.cancelRequest).toHaveBeenCalledWith(
        'token',
        'req-uuid',
      );
    });
  });

  describe('removeFriend', () => {
    it('should delegate to interactionClient.removeFriend', async () => {
      interactionClient.removeFriend.mockResolvedValue({ message: 'Removed' });

      await service.removeFriend('token', 'friend-uuid');

      expect(interactionClient.removeFriend).toHaveBeenCalledWith(
        'token',
        'friend-uuid',
      );
    });
  });

  describe('blockUser', () => {
    it('should delegate to interactionClient.blockUser', async () => {
      interactionClient.blockUser.mockResolvedValue({ message: 'Blocked' });

      await service.blockUser('token', 'user-uuid');

      expect(interactionClient.blockUser).toHaveBeenCalledWith(
        'token',
        'user-uuid',
      );
    });
  });

  describe('unblockUser', () => {
    it('should delegate to interactionClient.unblockUser', async () => {
      interactionClient.unblockUser.mockResolvedValue({ message: 'Unblocked' });

      await service.unblockUser('token', 'user-uuid');

      expect(interactionClient.unblockUser).toHaveBeenCalledWith(
        'token',
        'user-uuid',
      );
    });

    it('should propagate errors from interactionClient', async () => {
      interactionClient.unblockUser.mockRejectedValue(
        new Error('Upstream error'),
      );

      await expect(service.unblockUser('token', 'user-uuid')).rejects.toThrow(
        'Upstream error',
      );
    });
  });
});
