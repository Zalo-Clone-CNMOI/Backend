/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * @file membership-query.service.spec.ts
 * @covers MembershipQueryService — internal read-only membership queries that
 *         back the ws-gateway HTTP endpoints. Ported from the former
 *         @libs/mvp-access ConversationMembershipService queries.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation, ConversationMember } from '@libs/database/entities';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';
import { MembershipQueryService } from '../services/membership-query.service';

describe('MembershipQueryService', () => {
  let service: MembershipQueryService;
  let memberRepo: { find: jest.Mock; findOne: jest.Mock };
  let convRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    memberRepo = { find: jest.fn(), findOne: jest.fn() };
    convRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipQueryService,
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepo,
        },
        { provide: getRepositoryToken(Conversation), useValue: convRepo },
      ],
    }).compile();

    service = module.get(MembershipQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMembershipBatch', () => {
    it('returns empty array for empty input without querying', async () => {
      expect(await service.getMembershipBatch('u1', [])).toEqual([]);
      expect(memberRepo.find).not.toHaveBeenCalled();
    });

    it('marks active members allowed with their conversation type and others denied', async () => {
      memberRepo.find.mockResolvedValue([
        {
          conversationId: 'conv-1',
          conversation: { id: 'conv-1', type: ConversationType.GROUP },
        },
      ]);

      const result = await service.getMembershipBatch('u1', [
        'conv-1',
        'conv-2',
      ]);

      expect(result).toEqual([
        {
          conversation_id: 'conv-1',
          allowed: true,
          conversation_type: ConversationType.GROUP,
        },
        { conversation_id: 'conv-2', allowed: false, conversation_type: null },
      ]);
    });
  });

  describe('getSendPermission', () => {
    it('denies a non-member', async () => {
      memberRepo.findOne.mockResolvedValue(null);
      expect(await service.getSendPermission('u1', 'conv-1')).toEqual({
        allowed: false,
        reason: 'not_member',
      });
    });

    it('allows sending in a direct conversation', async () => {
      memberRepo.findOne.mockResolvedValue({ role: 'member' });
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.DIRECT,
        settings: null,
      });
      expect(await service.getSendPermission('u1', 'conv-1')).toEqual({
        allowed: true,
      });
    });

    it('allows sending in a group when send_message is enabled', async () => {
      memberRepo.findOne.mockResolvedValue({ role: 'member' });
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: true } },
      });
      expect(await service.getSendPermission('u1', 'conv-1')).toEqual({
        allowed: true,
      });
    });

    it('denies a regular member when send_message is disabled', async () => {
      memberRepo.findOne.mockResolvedValue({ role: 'member' });
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      expect(await service.getSendPermission('u1', 'conv-1')).toEqual({
        allowed: false,
        reason: 'send_permission_denied',
      });
    });

    it('allows an admin/owner even when send_message is disabled', async () => {
      memberRepo.findOne.mockResolvedValue({
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });
      convRepo.findOne.mockResolvedValue({
        type: ConversationType.GROUP,
        settings: { permissions: { send_message: false } },
      });
      expect(await service.getSendPermission('u1', 'conv-1')).toEqual({
        allowed: true,
      });
    });
  });

  describe('listActiveMemberIds', () => {
    it('maps active memberships to user ids', async () => {
      memberRepo.find.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);
      expect(await service.listActiveMemberIds('conv-1')).toEqual(['a', 'b']);
    });
  });
});
