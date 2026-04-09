/**
 * @file friends.controller.spec.ts (interaction-service)
 *
 * Verifies FriendsController delegates every call to
 * FriendsService with the correct @CurrentUser() and parameters.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { RespondFriendRequestDtoActionEnum } from './dto';

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const user = {
  id: uuid(1),
  phone: '+84901234567',
  email: 'u@test.com',
  fullName: 'User Test',
  status: 'active',
};

describe('FriendsController', () => {
  let controller: FriendsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getFriends: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      getPendingRequests: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      getSentRequests: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      sendFriendRequest: jest
        .fn()
        .mockResolvedValue({ message: 'sent', requestId: uuid(9) }),
      respondToRequest: jest.fn().mockResolvedValue({ message: 'accepted' }),
      cancelRequest: jest.fn().mockResolvedValue({ message: 'cancelled' }),
      removeFriend: jest.fn().mockResolvedValue({ message: 'removed' }),
      blockUser: jest.fn().mockResolvedValue({ message: 'blocked' }),
      unblockUser: jest.fn().mockResolvedValue({ message: 'unblocked' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FriendsController],
      providers: [{ provide: FriendsService, useValue: service }],
    }).compile();

    controller = module.get(FriendsController);
  });

  it('getFriends → service.getFriends(userId, query)', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getFriends(user, query);
    expect(service.getFriends).toHaveBeenCalledWith(user.id, query);
  });

  it('getPendingRequests → service.getPendingRequests(userId, query)', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getPendingRequests(user, query);
    expect(service.getPendingRequests).toHaveBeenCalledWith(user.id, query);
  });

  it('getSentRequests → service.getSentRequests(userId, query)', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getSentRequests(user, query);
    expect(service.getSentRequests).toHaveBeenCalledWith(user.id, query);
  });

  it('sendFriendRequest → service.sendFriendRequest(userId, dto)', async () => {
    const dto = { userId: uuid(2) };
    await controller.sendFriendRequest(user, dto);
    expect(service.sendFriendRequest).toHaveBeenCalledWith(user.id, dto);
  });

  it('respondToRequest → service.respondToRequest(userId, requestId, dto)', async () => {
    const dto = { action: RespondFriendRequestDtoActionEnum.accept };
    await controller.respondToRequest(user, uuid(9), dto);
    expect(service.respondToRequest).toHaveBeenCalledWith(
      user.id,
      uuid(9),
      dto,
    );
  });

  it('cancelRequest → service.cancelRequest(userId, requestId)', async () => {
    await controller.cancelRequest(user, uuid(9));
    expect(service.cancelRequest).toHaveBeenCalledWith(user.id, uuid(9));
  });

  it('removeFriend → service.removeFriend(userId, friendId)', async () => {
    await controller.removeFriend(user, uuid(2));
    expect(service.removeFriend).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('blockUser → service.blockUser(userId, targetUserId)', async () => {
    await controller.blockUser(user, uuid(2));
    expect(service.blockUser).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('unblockUser → service.unblockUser(userId, targetUserId)', async () => {
    await controller.unblockUser(user, uuid(2));
    expect(service.unblockUser).toHaveBeenCalledWith(user.id, uuid(2));
  });
});
