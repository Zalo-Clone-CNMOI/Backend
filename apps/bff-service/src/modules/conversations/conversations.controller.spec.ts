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
      createPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      listPolls: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getPollDetail: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      editPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      castPollVote: jest.fn().mockResolvedValue({ ok: true }),
      retractPollVote: jest.fn().mockResolvedValue({ ok: true }),
      addPollOption: jest.fn().mockResolvedValue({ id: 'opt-1' }),
      removePollOption: jest.fn().mockResolvedValue({ ok: true }),
      closePoll: jest.fn().mockResolvedValue({ ok: true }),
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

  // ─── Polls ──────────────────────────────────────────────

  describe('POST /:conversationId/polls (createPoll)', () => {
    it('should delegate with token, conversationId, and DTO', async () => {
      const dto = {
        question: 'Lunch?',
        options: [{ label: 'A' }, { label: 'B' }],
      };
      const result = await controller.createPoll(TOKEN, 'conv-1', dto);

      expect(svc.createPoll).toHaveBeenCalledWith(TOKEN, 'conv-1', dto);
      expect(result).toEqual({ id: 'poll-1' });
    });
  });

  describe('GET /:conversationId/polls (listPolls)', () => {
    it('should delegate with token, conversationId, and query', async () => {
      const query = { page: 1, limit: 20 };
      const result = await controller.listPolls(TOKEN, 'conv-1', query);

      expect(svc.listPolls).toHaveBeenCalledWith(TOKEN, 'conv-1', query);
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('GET /:conversationId/polls/:pollId (getPollDetail)', () => {
    it('should delegate with token, conversationId, and pollId', async () => {
      const result = await controller.getPollDetail(TOKEN, 'conv-1', 'poll-1');

      expect(svc.getPollDetail).toHaveBeenCalledWith(TOKEN, 'conv-1', 'poll-1');
      expect(result).toEqual({ id: 'poll-1' });
    });
  });

  describe('PATCH /:conversationId/polls/:pollId (editPoll)', () => {
    it('should delegate with token, conversationId, pollId, and DTO', async () => {
      const dto = { question: 'Updated?' };
      const result = await controller.editPoll(TOKEN, 'conv-1', 'poll-1', dto);

      expect(svc.editPoll).toHaveBeenCalledWith(TOKEN, 'conv-1', 'poll-1', dto);
      expect(result).toEqual({ id: 'poll-1' });
    });
  });

  describe('POST /:conversationId/polls/:pollId/vote (castPollVote)', () => {
    it('should delegate option_ids array (not the wrapper DTO)', async () => {
      const dto = { option_ids: ['opt-1', 'opt-2'] };
      const result = await controller.castPollVote(
        TOKEN,
        'conv-1',
        'poll-1',
        dto,
      );

      expect(svc.castPollVote).toHaveBeenCalledWith(TOKEN, 'conv-1', 'poll-1', [
        'opt-1',
        'opt-2',
      ]);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('DELETE /:conversationId/polls/:pollId/vote (retractPollVote)', () => {
    it('should delegate with token, conversationId, and pollId', async () => {
      const result = await controller.retractPollVote(
        TOKEN,
        'conv-1',
        'poll-1',
      );

      expect(svc.retractPollVote).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'poll-1',
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('POST /:conversationId/polls/:pollId/options (addPollOption)', () => {
    it('should delegate label string (not the wrapper DTO)', async () => {
      const dto = { label: 'Pho' };
      const result = await controller.addPollOption(
        TOKEN,
        'conv-1',
        'poll-1',
        dto,
      );

      expect(svc.addPollOption).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'poll-1',
        'Pho',
      );
      expect(result).toEqual({ id: 'opt-1' });
    });
  });

  describe('DELETE /:conversationId/polls/:pollId/options/:optionId (removePollOption)', () => {
    it('should delegate with token, conversationId, pollId, optionId', async () => {
      const result = await controller.removePollOption(
        TOKEN,
        'conv-1',
        'poll-1',
        'opt-2',
      );

      expect(svc.removePollOption).toHaveBeenCalledWith(
        TOKEN,
        'conv-1',
        'poll-1',
        'opt-2',
      );
      expect(result).toEqual({ ok: true });
    });

    it('should propagate permission errors', async () => {
      svc.removePollOption.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.removePollOption(TOKEN, 'conv-1', 'poll-1', 'opt-2'),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('POST /:conversationId/polls/:pollId/close (closePoll)', () => {
    it('should delegate with token, conversationId, and pollId', async () => {
      const result = await controller.closePoll(TOKEN, 'conv-1', 'poll-1');

      expect(svc.closePoll).toHaveBeenCalledWith(TOKEN, 'conv-1', 'poll-1');
      expect(result).toEqual({ ok: true });
    });
  });
});
