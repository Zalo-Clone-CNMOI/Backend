/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations.controller.spec.ts (interaction-service)
 *
 * Verifies ConversationsController delegates every call to
 * ConversationsService with the correct parameter ordering.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const user = { id: uuid(1), email: 'u@test.com' } as any;

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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: service }],
    }).compile();

    controller = module.get(ConversationsController);
  });

  it('getConversations → service.getConversations(userId, query)', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getConversations(user, query as any);
    expect(service.getConversations).toHaveBeenCalledWith(user.id, query);
  });

  it('getConversationById → service.getConversationById(userId, id)', async () => {
    await controller.getConversationById(user, uuid(2));
    expect(service.getConversationById).toHaveBeenCalledWith(user.id, uuid(2));
  });

  it('createGroupConversation → service.createGroupConversation(userId, dto)', async () => {
    const dto = { name: 'Group', memberIds: [uuid(3)] };
    await controller.createGroupConversation(user, dto as any);
    expect(service.createGroupConversation).toHaveBeenCalledWith(user.id, dto);
  });

  it('createDirectConversation → service.createDirectConversation(userId, dto)', async () => {
    const dto = { participantId: uuid(3) };
    await controller.createDirectConversation(user, dto as any);
    expect(service.createDirectConversation).toHaveBeenCalledWith(user.id, dto);
  });

  it('updateConversation → service.updateConversation(userId, convId, dto)', async () => {
    const dto = { name: 'Updated' };
    await controller.updateConversation(user, uuid(2), dto as any);
    expect(service.updateConversation).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      dto,
    );
  });

  it('addMembers → service.addMembers(userId, convId, dto)', async () => {
    const dto = { memberIds: [uuid(4)] };
    await controller.addMembers(user, uuid(2), dto as any);
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
    const dto = { role: 'admin' };
    await controller.updateMemberRole(user, uuid(2), uuid(3), dto as any);
    expect(service.updateMemberRole).toHaveBeenCalledWith(
      user.id,
      uuid(2),
      uuid(3),
      dto,
    );
  });

  it('updateMySettings → service.updateMySettings(userId, convId, dto)', async () => {
    const dto = { nickname: 'My Alias' };
    await controller.updateMySettings(user, uuid(2), dto as any);
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
});
