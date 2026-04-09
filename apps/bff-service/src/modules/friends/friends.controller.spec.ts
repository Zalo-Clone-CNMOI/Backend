/**
 * @file friends.controller.spec.ts (BFF)
 *
 * Unit tests for BFF FriendsController — verifies token extraction via
 * @AccessToken() and correct delegation to FriendsService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

describe('BFF FriendsController', () => {
  let controller: FriendsController;
  let friendsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    friendsService = {
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
      controllers: [FriendsController],
      providers: [{ provide: FriendsService, useValue: friendsService }],
    }).compile();

    controller = module.get<FriendsController>(FriendsController);
  });

  describe('GET /friends', () => {
    it('should pass token, page, and limit to service', async () => {
      friendsService.getFriends.mockResolvedValue({ items: [] });

      await controller.getFriends('access-token', 1, 20);

      expect(friendsService.getFriends).toHaveBeenCalledWith(
        'access-token',
        1,
        20,
      );
    });
  });

  describe('GET /friends/requests/pending', () => {
    it('should delegate to getPendingRequests', async () => {
      friendsService.getPendingRequests.mockResolvedValue({ items: [] });

      await controller.getPendingRequests('token', 1, 10);

      expect(friendsService.getPendingRequests).toHaveBeenCalledWith(
        'token',
        1,
        10,
      );
    });
  });

  describe('GET /friends/requests/sent', () => {
    it('should delegate to getSentRequests', async () => {
      friendsService.getSentRequests.mockResolvedValue({ items: [] });

      await controller.getSentRequests('token', 1, 10);

      expect(friendsService.getSentRequests).toHaveBeenCalledWith(
        'token',
        1,
        10,
      );
    });
  });

  describe('POST /friends/requests', () => {
    it('should delegate to sendFriendRequest with token and dto', async () => {
      const dto = { userId: 'target-uuid' } as unknown;
      friendsService.sendFriendRequest.mockResolvedValue({ message: 'Sent' });

      await controller.sendFriendRequest('token', dto);

      expect(friendsService.sendFriendRequest).toHaveBeenCalledWith(
        'token',
        dto,
      );
    });
  });

  describe('PATCH /friends/requests/:requestId', () => {
    it('should delegate to respondToRequest with token, requestId, and dto', async () => {
      const dto = { action: 'accept' } as unknown;
      friendsService.respondToRequest.mockResolvedValue({
        message: 'Accepted',
      });

      await controller.respondToRequest('token', 'req-uuid', dto);

      expect(friendsService.respondToRequest).toHaveBeenCalledWith(
        'token',
        'req-uuid',
        dto,
      );
    });
  });

  describe('DELETE /friends/requests/:requestId', () => {
    it('should delegate to cancelRequest', async () => {
      friendsService.cancelRequest.mockResolvedValue({ message: 'Cancelled' });

      await controller.cancelRequest('token', 'req-uuid');

      expect(friendsService.cancelRequest).toHaveBeenCalledWith(
        'token',
        'req-uuid',
      );
    });
  });

  describe('DELETE /friends/:friendId', () => {
    it('should delegate to removeFriend', async () => {
      friendsService.removeFriend.mockResolvedValue({ message: 'Removed' });

      await controller.removeFriend('token', 'friend-uuid');

      expect(friendsService.removeFriend).toHaveBeenCalledWith(
        'token',
        'friend-uuid',
      );
    });
  });

  describe('POST /friends/:userId/block', () => {
    it('should delegate to blockUser', async () => {
      friendsService.blockUser.mockResolvedValue({ message: 'Blocked' });

      await controller.blockUser('token', 'user-uuid');

      expect(friendsService.blockUser).toHaveBeenCalledWith(
        'token',
        'user-uuid',
      );
    });
  });

  describe('DELETE /friends/:userId/block', () => {
    it('should delegate to unblockUser', async () => {
      friendsService.unblockUser.mockResolvedValue({ message: 'Unblocked' });

      await controller.unblockUser('token', 'user-uuid');

      expect(friendsService.unblockUser).toHaveBeenCalledWith(
        'token',
        'user-uuid',
      );
    });
  });
});
