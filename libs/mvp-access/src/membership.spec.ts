/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * @file membership.spec.ts
 * @covers ConversationMembershipService – TypeORM-based conversation access control
 * @maps TC-SEC-005 (IDOR prevention), TC-SEC-006 (membership boundary),
 *       TC-SVC-006 (conversation access), TC-DB-003 (query correctness)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConversationMembershipService,
  canUserAccessConversation,
  listConversationsForUser,
} from './membership';
import { Logger } from '@nestjs/common';
import { Conversation, ConversationMember } from '@libs/database/entities';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';

// ────── Mock Repository ──────────────────────────────────────────────────

function createMockRepository() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('ConversationMembershipService', () => {
  let service: ConversationMembershipService;
  let repo: ReturnType<typeof createMockRepository>;
  let convRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    repo = createMockRepository();
    convRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMembershipService,
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: repo,
        },
        {
          provide: getRepositoryToken(Conversation),
          useValue: convRepo,
        },
      ],
    }).compile();

    service = module.get(ConversationMembershipService);
  });

  // ── canUserAccessConversation ─────────────────────────────────────────

  describe('canUserAccessConversation', () => {
    it('should return true when user is an active member', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-1',
      );

      expect(result).toBe(true);
      expect(repo.find).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          conversationId: expect.anything(),
          leftAt: expect.anything(), // IsNull()
        },
        select: ['conversationId'],
      });
    });

    it('should return false when user is not a member', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-999',
      );

      expect(result).toBe(false);
    });

    it('should return false for user who has left (leftAt is set)', async () => {
      // The query includes leftAt: IsNull(), so a left member won't be found
      repo.find.mockResolvedValue([]);

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-1',
      );

      expect(result).toBe(false);
    });

    it('should correctly filter by both userId and conversationId', async () => {
      repo.find.mockResolvedValue([]);

      await service.canUserAccessConversation('attacker', 'private-conv');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'attacker',
            conversationId: expect.anything(),
          }),
        }),
      );
    });

    it('should batch concurrent checks for same user into one repository query', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);

      const [conv1, conv2] = await Promise.all([
        service.canUserAccessConversation('user-1', 'conv-1'),
        service.canUserAccessConversation('user-1', 'conv-2'),
      ]);

      expect(conv1).toBe(true);
      expect(conv2).toBe(false);
      expect(repo.find).toHaveBeenCalledTimes(1);

      // Verify the single query covered BOTH conversation IDs in one In() clause
      // so a regression that fires two separate single-id queries would fail here.
      // Use the public `.value` getter on TypeORM's FindOperator (not `._value`,
      // which is a private implementation detail subject to change across versions).
      const [[findArgs]] = repo.find.mock.calls as Array<
        [{ where: { conversationId: { value: string[] } } }]
      >;
      const batchedIds = findArgs.where.conversationId.value;
      expect(batchedIds).toEqual(expect.arrayContaining(['conv-1', 'conv-2']));
      expect(batchedIds).toHaveLength(2);
    });

    it('should reuse short-lived cache for repeated access checks', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);

      const first = await service.canUserAccessConversation('user-1', 'conv-1');
      const second = await service.canUserAccessConversation(
        'user-1',
        'conv-1',
      );

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('should reject when repository access fails during batch flush', async () => {
      repo.find.mockRejectedValue(new Error('db unavailable'));

      await expect(
        service.canUserAccessConversation('user-1', 'conv-1'),
      ).rejects.toThrow('db unavailable');
    });
  });

  // ── listConversationsForUser ──────────────────────────────────────────

  describe('listConversationsForUser', () => {
    it('should return conversation IDs for active memberships', async () => {
      repo.find.mockResolvedValue([
        { conversationId: 'conv-1' },
        { conversationId: 'conv-2' },
        { conversationId: 'conv-3' },
      ]);

      const result = await service.listConversationsForUser('user-1');

      expect(result).toEqual(['conv-1', 'conv-2', 'conv-3']);
    });

    it('should return empty array when user has no active memberships', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.listConversationsForUser('user-no-convs');

      expect(result).toEqual([]);
    });

    it('should only select conversationId field', async () => {
      repo.find.mockResolvedValue([]);

      await service.listConversationsForUser('user-1');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: ['conversationId'],
        }),
      );
    });
  });

  describe('listActiveMemberIds', () => {
    it('should return active member user IDs for a conversation', async () => {
      repo.find.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);

      const result = await service.listActiveMemberIds('conv-1');

      expect(result).toEqual(['user-1', 'user-2']);
      expect(repo.find).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          leftAt: expect.anything(),
        },
        select: ['userId'],
      });
    });

    it('should return empty array when conversation has no active members', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.listActiveMemberIds('conv-empty');

      expect(result).toEqual([]);
    });
  });

  // ── canUserAccessConversations (batch) ────────────────────────────────

  describe('canUserAccessConversations', () => {
    it('should return a Map with access status for each conversation', async () => {
      repo.find.mockResolvedValue([
        { conversationId: 'conv-1' },
        { conversationId: 'conv-3' },
      ]);

      const result = await service.canUserAccessConversations('user-1', [
        'conv-1',
        'conv-2',
        'conv-3',
      ]);

      expect(result.get('conv-1')).toBe(true);
      expect(result.get('conv-2')).toBe(false);
      expect(result.get('conv-3')).toBe(true);
    });

    it('should return empty Map for empty input', async () => {
      const result = await service.canUserAccessConversations('user-1', []);

      expect(result.size).toBe(0);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('should handle single conversation', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-only' }]);

      const result = await service.canUserAccessConversations('user-1', [
        'conv-only',
      ]);

      expect(result.get('conv-only')).toBe(true);
    });
  });

  // ── canUserSendMessage ────────────────────────────────────────────────

  describe('canUserSendMessage', () => {
    it('should return not_member when user is not an active member', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: false, reason: 'not_member' });
      expect(convRepo.findOne).not.toHaveBeenCalled();
    });

    it('should return allowed for non-GROUP conversation', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({ type: 'direct', settings: null });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: true });
    });

    it('should return allowed when GROUP has null settings (default permissive)', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: null,
      });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: true });
    });

    it('should return allowed when GROUP has send_message=true', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: true } },
      });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: true });
    });

    it('should return allowed for OWNER when send_message=false', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.OWNER,
      });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: true });
    });

    it('should return allowed for ADMIN when send_message=false', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({ allowed: true });
    });

    it('should return send_permission_denied for MEMBER when send_message=false', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({
        allowed: false,
        reason: 'send_permission_denied',
      });
    });

    it('should use settings cache and skip convRepo on second call', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: true } },
      });

      await service.canUserSendMessage('user-1', 'conv-1');
      await service.canUserSendMessage('user-1', 'conv-1');

      expect(convRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('should use role cache and skip memberRepo.findOne on second call when send_message=false', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      await service.canUserSendMessage('user-1', 'conv-1');
      await service.canUserSendMessage('user-1', 'conv-1');

      expect(repo.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return send_permission_denied when role lookup returns undefined', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue(null);

      const result = await service.canUserSendMessage('user-1', 'conv-1');

      expect(result).toEqual({
        allowed: false,
        reason: 'send_permission_denied',
      });
    });
  });

  // ── invalidateSettingsCache ───────────────────────────────────────────

  describe('invalidateSettingsCache', () => {
    it('should force re-query on the next canUserSendMessage call', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: true } },
      });

      await service.canUserSendMessage('user-1', 'conv-1');
      expect(convRepo.findOne).toHaveBeenCalledTimes(1);

      service.invalidateSettingsCache('conv-1');

      await service.canUserSendMessage('user-1', 'conv-1');
      expect(convRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('should also sweep roleCache so role is re-fetched after settings change', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      // Prime both caches
      await service.canUserSendMessage('user-1', 'conv-1');
      expect(repo.findOne).toHaveBeenCalledTimes(1);

      // Invalidate should flush both settings cache and roleCache
      service.invalidateSettingsCache('conv-1');

      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      await service.canUserSendMessage('user-1', 'conv-1');
      // Role must be re-fetched — not served from the now-cleared roleCache
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  // ── invalidateRoleCache ───────────────────────────────────────────────

  describe('invalidateRoleCache', () => {
    it('should force role re-fetch on the next canUserSendMessage call', async () => {
      repo.find.mockResolvedValue([{ conversationId: 'conv-1' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      // Prime role cache
      await service.canUserSendMessage('user-1', 'conv-1');
      expect(repo.findOne).toHaveBeenCalledTimes(1);

      service.invalidateRoleCache('user-1', 'conv-1');

      // Role cache cleared — next call must hit DB again
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });
      const result = await service.canUserSendMessage('user-1', 'conv-1');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        allowed: false,
        reason: 'send_permission_denied',
      });
    });

    it('should not affect role cache for other conversations', async () => {
      repo.find
        .mockResolvedValueOnce([{ conversationId: 'conv-1' }])
        .mockResolvedValueOnce([{ conversationId: 'conv-2' }]);
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      repo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      await service.canUserSendMessage('user-1', 'conv-1');
      await service.canUserSendMessage('user-1', 'conv-2');
      expect(repo.findOne).toHaveBeenCalledTimes(2);

      // Invalidate only conv-1
      service.invalidateRoleCache('user-1', 'conv-1');

      // conv-2 role still cached — no extra DB call
      repo.find.mockResolvedValue([{ conversationId: 'conv-2' }]);
      await service.canUserSendMessage('user-1', 'conv-2');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  // ── Deprecated functions ──────────────────────────────────────────────

  describe('deprecated standalone functions', () => {
    it('canUserAccessConversation() should return false and warn', () => {
      const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      expect(canUserAccessConversation()).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      spy.mockRestore();
    });

    it('listConversationsForUser() should return empty array and warn', () => {
      const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      expect(listConversationsForUser()).toEqual([]);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      spy.mockRestore();
    });
  });
});
