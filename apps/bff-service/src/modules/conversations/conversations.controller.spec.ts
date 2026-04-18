/**
 * @file conversations.controller.spec.ts (bff-service)
 *
 * Unit tests for ConversationsController — verifies that all 10
 * endpoints properly delegate to ConversationsService with the
 * correct token, params, and DTOs.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { UpdateMemberRoleDtoRoleEnum } from '@app/clients/interaction-client';

describe('ConversationsController (BFF)', () => {
  let controller: ConversationsController;
  let svc: Record<string, jest.Mock>;

  const TOKEN = 'Bearer jwt-token';

  beforeEach(async () => {
    svc = {
      getConversations: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getConversationById: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      createGroupConversation: jest.fn().mockResolvedValue({ id: 'conv-g' }),
      createDirectConversation: jest.fn().mockResolvedValue({ id: 'conv-d' }),
      updateConversation: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', name: 'Updated' }),
      addMembers: jest.fn().mockResolvedValue({ ok: true }),
      removeMember: jest.fn().mockResolvedValue({ ok: true }),
      leaveConversation: jest.fn().mockResolvedValue({ ok: true }),
      updateMemberRole: jest.fn().mockResolvedValue({ ok: true }),
      updateMySettings: jest.fn().mockResolvedValue({ ok: true }),
      markAsRead: jest.fn().mockResolvedValue({ ok: true }),
      pinConversation: jest.fn().mockResolvedValue({ ok: true }),
      unpinConversation: jest.fn().mockResolvedValue({ ok: true }),
      getConversationCallState: jest
        .fn()
        .mockResolvedValue({ conversation_id: 'conv-1', state: null }),
      endConversationCall: jest
        .fn()
        .mockResolvedValue({ message: 'Call end requested' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: svc }],
    }).compile();

    controller = module.get<ConversationsController>(ConversationsController);
  });

  // ─── GET / ───────────────────────────────────────────

  describe('GET / (getConversations)', () => {
    it('should delegate with token, page, limit', async () => {
      const result = await controller.getConversations(TOKEN, 1, 20);

      expect(svc.getConversations).toHaveBeenCalledWith(TOKEN, 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should handle omitted pagination params', async () => {
      await controller.getConversations(TOKEN);

      expect(svc.getConversations).toHaveBeenCalledWith(
        TOKEN,
        undefined,
        undefined,
      );
    });
  });

  // ─── GET /:conversationId ────────────────────────────

  describe('GET /:conversationId', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.getConversationById(TOKEN, 'conv-1');

      expect(svc.getConversationById).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ id: 'conv-1' });
    });

    it('should propagate 404 errors', async () => {
      svc.getConversationById.mockRejectedValue(new Error('Not found'));

      await expect(
        controller.getConversationById(TOKEN, 'missing'),
      ).rejects.toThrow('Not found');
    });
  });

  // ─── POST /group ─────────────────────────────────────

  describe('POST /group (createGroupConversation)', () => {
    it('should delegate with token and group DTO', async () => {
      const dto = { name: 'Team', memberIds: ['u1', 'u2'] };
      const result = await controller.createGroupConversation(TOKEN, dto);

      expect(svc.createGroupConversation).toHaveBeenCalledWith(TOKEN, dto);
      expect(result).toEqual({ id: 'conv-g' });
    });
  });

  // ─── POST /direct ────────────────────────────────────

  describe('POST /direct (createDirectConversation)', () => {
    it('should delegate with token and direct DTO', async () => {
      const dto = { participantId: 'u2' };
      const result = await controller.createDirectConversation(TOKEN, dto);

      expect(svc.createDirectConversation).toHaveBeenCalledWith(TOKEN, dto);
      expect(result).toEqual({ id: 'conv-d' });
    });
  });

  // ─── PATCH /:conversationId ──────────────────────────

  describe('PATCH /:conversationId (updateConversation)', () => {
    it('should delegate with token, id, and update DTO', async () => {
      const dto = { name: 'Renamed' };
      const result = await controller.updateConversation(TOKEN, 'conv-1', dto);

      expect(svc.updateConversation).toHaveBeenCalledWith(TOKEN, 'conv-1', dto);
      expect(result).toEqual({ id: 'conv-1', name: 'Updated' });
    });
  });

  // ─── POST /:conversationId/members ───────────────────

  describe('POST /:conversationId/members (addMembers)', () => {
    it('should delegate with token, id, and add-members DTO', async () => {
      const dto = { memberIds: ['u3'] };
      const result = await controller.addMembers(TOKEN, 'conv-1', dto);

      expect(svc.addMembers).toHaveBeenCalledWith(TOKEN, 'conv-1', dto);
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── DELETE /:conversationId/members/:memberId ───────

  describe('DELETE /:conversationId/members/:memberId', () => {
    it('should delegate with token, conversationId, memberId', async () => {
      const result = await controller.removeMember(TOKEN, 'conv-1', 'u3');

      expect(svc.removeMember).toHaveBeenCalledWith(TOKEN, 'conv-1', 'u3');
      expect(result).toEqual({ ok: true });
    });

    it('should propagate permission errors', async () => {
      svc.removeMember.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.removeMember(TOKEN, 'conv-1', 'u3'),
      ).rejects.toThrow('Forbidden');
    });
  });

  // ─── POST /:conversationId/leave ─────────────────────

  describe('POST /:conversationId/leave (leaveConversation)', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.leaveConversation(TOKEN, 'conv-1');

      expect(svc.leaveConversation).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── PATCH /:conversationId/members/:memberId/role ───

  describe('PATCH /:conversationId/members/:memberId/role', () => {
    it('should delegate with token, conversationId, memberId, role DTO', async () => {
      const dto = { role: UpdateMemberRoleDtoRoleEnum.admin };
      const result = await controller.updateMemberRole(
        TOKEN,
        'conv-1',
        'u2',
        dto,
      );

      expect(svc.updateMemberRole).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'u2',
        dto,
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── PATCH /:conversationId/settings ─────────────────

  describe('PATCH /:conversationId/settings (updateMySettings)', () => {
    it('should delegate with token, conversationId, settings DTO', async () => {
      const dto = { isMuted: true };
      const result = await controller.updateMySettings(TOKEN, 'conv-1', dto);

      expect(svc.updateMySettings).toHaveBeenCalledWith(TOKEN, 'conv-1', dto);
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── POST /:conversationId/read ──────────────────────

  describe('POST /:conversationId/read (markAsRead)', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.markAsRead(TOKEN, 'conv-1');

      expect(svc.markAsRead).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });

    it('should propagate service errors', async () => {
      svc.markAsRead.mockRejectedValue(new Error('Service down'));

      await expect(controller.markAsRead(TOKEN, 'conv-1')).rejects.toThrow(
        'Service down',
      );
    });
  });

  describe('POST /:conversationId/pin (pinConversation)', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.pinConversation(TOKEN, 'conv-1');

      expect(svc.pinConversation).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('DELETE /:conversationId/pin (unpinConversation)', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.unpinConversation(TOKEN, 'conv-1');

      expect(svc.unpinConversation).toHaveBeenCalledWith(TOKEN, 'conv-1');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('GET /:conversationId/call-state (getConversationCallState)', () => {
    it('should delegate with token and conversationId', async () => {
      const result = await controller.getConversationCallState(TOKEN, 'conv-1');

      expect(svc.getConversationCallState).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
      );
      expect(result).toEqual({ conversation_id: 'conv-1', state: null });
    });
  });

  describe('POST /:conversationId/calls/:callId/end (endConversationCall)', () => {
    it('should delegate with token, conversationId, callId, and body', async () => {
      const dto = { reason: 'user_hangup' };
      const result = await controller.endConversationCall(
        TOKEN,
        'conv-1',
        'call-1',
        dto,
      );

      expect(svc.endConversationCall).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'call-1',
        dto,
      );
      expect(result).toEqual({ message: 'Call end requested' });
    });
  });
});
