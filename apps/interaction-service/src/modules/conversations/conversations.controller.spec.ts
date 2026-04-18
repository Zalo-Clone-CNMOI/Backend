/**
 * @file conversations.controller.spec.ts (interaction-service)
 *
 * Verifies ConversationsController delegates every call to
 * ConversationsService with the correct parameter ordering.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const user = {
  id: uuid(1),
  phone: '+84901234567',
  email: 'u@test.com',
  fullName: 'User Test',
  status: 'active',
};

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getConversations: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      getConversationById: jest.fn().mockResolvedValue({ id: uuid(2) }),
      createGroupConversation: jest.fn().mockResolvedValue({ id: uuid(2) }),
      createDirectConversation: jest.fn().mockResolvedValue({ id: uuid(2) }),
      updateConversation: jest.fn().mockResolvedValue({ id: uuid(2) }),
      addMembers: jest.fn().mockResolvedValue({ id: uuid(2) }),
      removeMember: jest.fn().mockResolvedValue({ message: 'removed' }),
      leaveConversation: jest.fn().mockResolvedValue({ message: 'left' }),
      updateMemberRole: jest.fn().mockResolvedValue({ message: 'updated' }),
      updateMySettings: jest
        .fn()
        .mockResolvedValue({ message: 'settings updated' }),
      markAsRead: jest.fn().mockResolvedValue({ message: 'read' }),
      pinConversation: jest.fn().mockResolvedValue({ message: 'pinned' }),
      unpinConversation: jest.fn().mockResolvedValue({ message: 'unpinned' }),
      getConversationCallState: jest
        .fn()
        .mockResolvedValue({ conversation_id: uuid(2), state: null }),
      endConversationCall: jest
        .fn()
        .mockResolvedValue({ message: 'Call end requested' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: service }],
    }).compile();

    controller = module.get(ConversationsController);
  });

  it('getConversations → service.getConversations(userId, query)', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getConversations(user, query);
    expect(service.getConversations).toHaveBeenCalledWith(user.id, query);
  });

  it('getConversationById → service.getConversationById(userId, id)', async () => {
    await controller.getConversationById(user, uuid(2));
    expect(service.getConversationById).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('createGroupConversation → service.createGroupConversation(userId, dto)', async () => {
    const dto = { name: 'Group', memberIds: [uuid(3)] };
    await controller.createGroupConversation(user, dto);
    expect(service.createGroupConversation).toHaveBeenCalledWith(user.id, dto);
  });

  it('createDirectConversation → service.createDirectConversation(userId, dto)', async () => {
    const dto = { participantId: uuid(3) };
    await controller.createDirectConversation(user, dto);
    expect(service.createDirectConversation).toHaveBeenCalledWith(user.id, dto);
  });

  it('updateConversation → service.updateConversation(userId, convId, dto)', async () => {
    const dto = { name: 'Updated' };
    await controller.updateConversation(user, uuid(2), dto);
    expect(service.updateConversation).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      dto,
    );
  });

  it('addMembers → service.addMembers(userId, convId, dto)', async () => {
    const dto = { memberIds: [uuid(4)] };
    await controller.addMembers(user, uuid(2), dto);
    expect(service.addMembers).toHaveBeenCalledWith(user.id, uuid(2), dto);
  });

  it('removeMember → service.removeMember(userId, convId, memberId)', async () => {
    await controller.removeMember(user, uuid(2), uuid(3));
    expect(service.removeMember).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      uuid(3),
    );
  });

  it('leaveConversation → service.leaveConversation(userId, convId)', async () => {
    await controller.leaveConversation(user, uuid(2));
    expect(service.leaveConversation).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('updateMemberRole → service.updateMemberRole(userId, convId, memberId, dto)', async () => {
    const dto = { role: UpdateMemberRoleDtoRoleEnum.ADMIN };
    await controller.updateMemberRole(user, uuid(2), uuid(3), dto);
    expect(service.updateMemberRole).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      uuid(3),
      dto,
    );
  });

  it('updateMySettings → service.updateMySettings(userId, convId, dto)', async () => {
    const dto = { nickname: 'My Alias' };
    await controller.updateMySettings(user, uuid(2), dto);
    expect(service.updateMySettings).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      dto,
    );
  });

  it('markAsRead → service.markAsRead(userId, convId)', async () => {
    await controller.markAsRead(user, uuid(2));
    expect(service.markAsRead).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('pinConversation → service.pinConversation(userId, convId)', async () => {
    await controller.pinConversation(user, uuid(2));
    expect(service.pinConversation).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('unpinConversation → service.unpinConversation(userId, convId)', async () => {
    await controller.unpinConversation(user, uuid(2));
    expect(service.unpinConversation).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('getConversationCallState → service.getConversationCallState(userId, convId)', async () => {
    await controller.getConversationCallState(user, uuid(2));
    expect(service.getConversationCallState).toHaveBeenCalledWith(
      user.id,
      uuid(2),
    );
  });

  it('endConversationCall → service.endConversationCall(userId, convId, callId, dto)', async () => {
    const dto = { reason: 'user_hangup' };
    await controller.endConversationCall(user, uuid(2), 'call-1', dto);
    expect(service.endConversationCall).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      'call-1',
      dto,
    );
  });
});
