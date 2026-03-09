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
import { ConversationMember } from '@libs/database/entities';

// ────── Mock Repository ──────────────────────────────────────────────────

function createMockRepository() {
  return {
    findOne: jest.fn(),
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
      repo.findOne.mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conv-1',
        leftAt: null,
      });

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-1',
      );

      expect(result).toBe(true);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          conversationId: 'conv-1',
          leftAt: expect.anything(), // IsNull()
        },
      });
    });

    it('should return false when user is not a member', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-999',
      );

      expect(result).toBe(false);
    });

    it('should return false for user who has left (leftAt is set)', async () => {
      // The query includes leftAt: IsNull(), so a left member won't be found
      repo.findOne.mockResolvedValue(null);

      const result = await service.canUserAccessConversation(
        'user-1',
        'conv-1',
      );

      expect(result).toBe(false);
    });

    it('should correctly filter by both userId and conversationId', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.canUserAccessConversation('attacker', 'private-conv');

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'attacker',
            conversationId: 'private-conv',
          }),
        }),
      );
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
      const spy = jest.spyOn(console, 'warn').mockImplementation();

      expect(canUserAccessConversation()).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      spy.mockRestore();
    });

    it('listConversationsForUser() should return empty array and warn', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation();

      expect(listConversationsForUser()).toEqual([]);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));

      spy.mockRestore();
    });
  });
});
