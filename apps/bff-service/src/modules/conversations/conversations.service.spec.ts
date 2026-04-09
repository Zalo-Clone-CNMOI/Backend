/**
 * @file conversations.service.spec.ts (bff-service)
 *
 * Unit tests for ConversationsService — a pure proxy layer that
 * delegates every call to InteractionClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { InteractionClientService } from '@app/clients/interaction-client';
import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';

describe('ConversationsService (BFF)', () => {
  let service: ConversationsService;
  let client: Record<string, jest.Mock>;

  const TOKEN = 'Bearer jwt-test-token';

  beforeEach(async () => {
    client = {
      getConversations: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getConversationById: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', name: 'Test' }),
      createGroupConversation: jest.fn().mockResolvedValue({ id: 'conv-new' }),
      createDirectConversation: jest.fn().mockResolvedValue({ id: 'conv-dm' }),
      updateConversation: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', name: 'Updated' }),
      addMembers: jest.fn().mockResolvedValue({ ok: true }),
      removeMember: jest.fn().mockResolvedValue({ ok: true }),
      leaveConversation: jest.fn().mockResolvedValue({ ok: true }),
      updateMemberRole: jest.fn().mockResolvedValue({ ok: true }),
      updateMySettings: jest.fn().mockResolvedValue({ ok: true }),
      markAsRead: jest.fn().mockResolvedValue({ ok: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: InteractionClientService, useValue: client },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  // ─── getConversations ────────────────────────────────

  describe('getConversations', () => {
    it('should delegate to interactionClient.getConversations', async () => {
      const result = await service.getConversations(TOKEN, 1, 20);

      expect(client.getConversations).toHaveBeenCalledWith(TOKEN, 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should pass undefined for optional page and limit', async () => {
      await service.getConversations(TOKEN);

      expect(client.getConversations).toHaveBeenCalledWith(
        TOKEN,
        undefined,
        undefined,
      );
    });

    it('should propagate errors', async () => {
      client.getConversations.mockRejectedValue(new Error('timeout'));

      await expect(service.getConversations(TOKEN)).rejects.toThrow('timeout');
    });
  });

  // ─── getConversationById ─────────────────────────────

  describe('getConversationById', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await service.getConversationById(TOKEN, 'conv-1');

      expect(client.getConversationById).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ id: 'conv-1', name: 'Test' });
    });

    it('should propagate 404 errors', async () => {
      client.getConversationById.mockRejectedValue(new Error('not found'));

      await expect(service.getConversationById(TOKEN, 'x')).rejects.toThrow(
        'not found',
      );
    });
  });

  // ─── createGroupConversation ─────────────────────────

  describe('createGroupConversation', () => {
    it('should delegate with token and DTO', async () => {
      const dto = { name: 'Team', memberIds: ['u1', 'u2'] };
      const result = await service.createGroupConversation(TOKEN, dto);

      expect(client.createGroupConversation).toHaveBeenCalledWith(TOKEN, dto);
      expect(result).toEqual({ id: 'conv-new' });
    });
  });

  // ─── createDirectConversation ────────────────────────

  describe('createDirectConversation', () => {
    it('should delegate with token and DTO', async () => {
      const dto = { participantId: 'u2' };
      const result = await service.createDirectConversation(TOKEN, dto);

      expect(client.createDirectConversation).toHaveBeenCalledWith(TOKEN, dto);
      expect(result).toEqual({ id: 'conv-dm' });
    });
  });

  // ─── updateConversation ──────────────────────────────

  describe('updateConversation', () => {
    it('should delegate with token, conversationId, and DTO', async () => {
      const dto = { name: 'Renamed' };
      const result = await service.updateConversation(TOKEN, 'conv-1', dto);

      expect(client.updateConversation).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        dto,
      );
      expect(result).toEqual({ id: 'conv-1', name: 'Updated' });
    });
  });

  // ─── addMembers ──────────────────────────────────────

  describe('addMembers', () => {
    it('should delegate with token, conversationId, and DTO', async () => {
      const dto = { memberIds: ['u3', 'u4'] };
      const result = await service.addMembers(TOKEN, 'conv-1', dto);

      expect(client.addMembers).toHaveBeenCalledWith(TOKEN, 'conv-1', dto);
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── removeMember ────────────────────────────────────

  describe('removeMember', () => {
    it('should delegate with token, conversationId, and memberId', async () => {
      const result = await service.removeMember(TOKEN, 'conv-1', 'u3');

      expect(client.removeMember).toHaveBeenCalledWith(TOKEN, 'conv-1', 'u3');
      expect(result).toEqual({ ok: true });
    });

    it('should propagate permission errors', async () => {
      client.removeMember.mockRejectedValue(new Error('forbidden'));

      await expect(service.removeMember(TOKEN, 'conv-1', 'u3')).rejects.toThrow(
        'forbidden',
      );
    });
  });

  // ─── leaveConversation ───────────────────────────────

  describe('leaveConversation', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await service.leaveConversation(TOKEN, 'conv-1');

      expect(client.leaveConversation).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── updateMemberRole ────────────────────────────────

  describe('updateMemberRole', () => {
    it('should delegate with token, conversationId, memberId, and DTO', async () => {
      const dto = { role: UpdateMemberRoleDtoRoleEnum.ADMIN };
      const result = await service.updateMemberRole(TOKEN, 'conv-1', 'u2', dto);

      expect(client.updateMemberRole).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'u2',
        dto,
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── updateMySettings ────────────────────────────────

  describe('updateMySettings', () => {
    it('should delegate with token, conversationId, and DTO', async () => {
      const dto = { notificationEnabled: false };
      const result = await service.updateMySettings(TOKEN, 'conv-1', dto);

      expect(client.updateMySettings).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        dto,
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── markAsRead ──────────────────────────────────────

  describe('markAsRead', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await service.markAsRead(TOKEN, 'conv-1');

      expect(client.markAsRead).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });

    it('should propagate errors', async () => {
      client.markAsRead.mockRejectedValue(new Error('Internal error'));

      await expect(service.markAsRead(TOKEN, 'conv-1')).rejects.toThrow(
        'Internal error',
      );
    });
  });
});
