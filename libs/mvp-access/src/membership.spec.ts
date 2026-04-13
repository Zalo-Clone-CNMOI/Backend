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
import { ConversationMember } from '@libs/database/entities';

// ────── Mock Repository ──────────────────────────────────────────────────

function createMockRepository() {
  return {
    find: jest.fn(),
  };
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('ConversationMembershipService', () => {
  let service: ConversationMembershipService;
  let repo: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    repo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMembershipService,
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: repo,
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
