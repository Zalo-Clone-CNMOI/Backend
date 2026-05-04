/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations-admin.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — admin/role operations:
 * updateMemberRole, transferOwnership, updateMySettings, markAsRead.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationsService } from '../conversations.service';
import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import { KAFKA_CLIENT, NotificationOutboxPublisher } from '@libs/kafka';
import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';
import { ConversationCoreService } from '../services/conversation-core.service';
import { ConversationMemberService } from '../services/conversation-member.service';
import { GroupInviteService } from '../services/group-invite.service';
import { ConversationPollService } from '../services/conversation-poll.service';
import { ConversationVoteService } from '../services/conversation-vote.service';
import { IsNull } from 'typeorm';
import { BusinessException } from '@app/types';

// ─── Mock Enums ──────────────────────────────────────────
const ConversationType = { DIRECT: 'direct', GROUP: 'group' };
// ─── Helpers ─────────────────────────────────────────────
const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

const createMockMember = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(9),
  conversationId: uuid(1),
  userId: uuid(2),
  role: UpdateMemberRoleDtoRoleEnum.MEMBER,
  nickname: null,
  isMuted: false,
  lastReadAt: null,
  joinedAt: new Date(),
  leftAt: null,
  user: { id: uuid(2), fullName: 'Member User', avatarUrl: null },
  ...overrides,
});

const createMockConversation = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(1),
  type: ConversationType.GROUP,
  name: 'Test Group',
  avatarUrl: null,
  createdById: uuid(2),
  lastMessageAt: new Date(),
  createdAt: new Date(),
  members: [
    createMockMember({
      userId: uuid(2),
      role: UpdateMemberRoleDtoRoleEnum.OWNER,
      user: { id: uuid(2), fullName: 'Owner User', avatarUrl: null },
    }),
    createMockMember({
      id: uuid(8),
      userId: uuid(3),
      user: { id: uuid(3), fullName: 'Member 2', avatarUrl: null },
    }),
  ],
  ...overrides,
});

type InviteRepositoryMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  manager: {
    transaction: jest.Mock;
  };
};

type MemberRepositoryMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  createQueryBuilder: jest.Mock;
  manager: {
    transaction: jest.Mock;
  };
};

describe('ConversationsService — admin operations', () => {
  let service: ConversationsService;
  let userRepository: Record<string, jest.Mock>;
  let conversationRepository: Record<string, jest.Mock>;
  let memberRepository: MemberRepositoryMock;
  let inviteRepository: InviteRepositoryMock;
  let cacheService: Record<string, jest.Mock>;
  let kafkaClient: Record<string, jest.Mock>;
  let notificationPublisher: Record<string, jest.Mock>;
  let redisClient: Record<string, jest.Mock>;
  let pollService: Record<string, jest.Mock>;
  let voteService: Record<string, jest.Mock>;

  beforeEach(async () => {
    userRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    conversationRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: uuid(1) })),
      save: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          ...data,
          id: data.id || uuid(1),
          createdAt: data.createdAt ?? new Date(),
        }),
      ),
      createQueryBuilder: jest.fn(),
    };

    memberRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn((cb: (manager: MemberRepositoryMock) => unknown) =>
          cb(memberRepository),
        ),
      },
    };

    inviteRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(),
      },
    };

    cacheService = {
      getConversationDetail: jest.fn().mockResolvedValue(null),
      setConversationDetail: jest.fn().mockResolvedValue(undefined),
      invalidateConversation: jest.fn().mockResolvedValue(undefined),
      invalidateConversationList: jest.fn().mockResolvedValue(undefined),
    };

    kafkaClient = {
      emit: jest.fn(),
    };

    notificationPublisher = {
      publish: jest.fn().mockResolvedValue('queued'),
    };

    redisClient = {
      mGet: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
    };

    pollService = {
      createPoll: jest.fn().mockResolvedValue({ poll_id: uuid(5) }),
      listPolls: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      getPollDetail: jest.fn().mockResolvedValue({ poll_id: uuid(5) }),
      editPoll: jest.fn().mockResolvedValue({ poll_id: uuid(5), edited_at: 1 }),
      addOption: jest.fn().mockResolvedValue({ option_id: uuid(6) }),
      removeOption: jest.fn().mockResolvedValue({ option_id: uuid(6) }),
      closePoll: jest.fn().mockResolvedValue({
        poll_id: uuid(5),
        status: 'closed',
        final_tally: [],
      }),
    };

    voteService = {
      castVote: jest.fn().mockResolvedValue({
        poll_id: uuid(5),
        option_ids_added: [],
        option_ids_removed: [],
      }),
      retractVote: jest
        .fn()
        .mockResolvedValue({ poll_id: uuid(5), deleted: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        ConversationCoreService,
        ConversationMemberService,
        GroupInviteService,
        { provide: ConversationPollService, useValue: pollService },
        { provide: ConversationVoteService, useValue: voteService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepository,
        },
        {
          provide: getRepositoryToken(ConversationInvite),
          useValue: inviteRepository,
        },
        { provide: CacheService, useValue: cacheService },
        { provide: KAFKA_CLIENT, useValue: kafkaClient },
        {
          provide: NotificationOutboxPublisher,
          useValue: notificationPublisher,
        },
        { provide: REDIS_CLIENT, useValue: redisClient },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ─── updateMemberRole ────────────────────────────────

  describe('updateMemberRole', () => {
    const installUpdateRoleTxMock = (
      conv: ReturnType<typeof createMockConversation>,
    ) => {
      const activeMembers = conv.members.filter((m) => m.leftAt === null);
      const memberUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const mockManager = {
        getRepository: jest.fn((entity: unknown) => {
          const entityName = (entity as { name?: string })?.name;
          if (entityName === 'Conversation') {
            return {
              createQueryBuilder: () => ({
                setLock: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(conv),
              }),
            };
          }
          if (entityName === 'ConversationMember') {
            return {
              findOne: jest
                .fn()
                .mockImplementation(
                  ({ where: { userId: uid } }: { where: { userId: string } }) =>
                    Promise.resolve(
                      activeMembers.find((m) => m.userId === uid) ?? null,
                    ),
                ),
              update: memberUpdate,
            };
          }
          return {};
        }),
      };

      memberRepository.manager = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (m: unknown) => unknown) => cb(mockManager)),
      };

      return { memberUpdate };
    };

    it('should update member role (owner only) via conditional UPDATE', async () => {
      const conv = createMockConversation();
      const { memberUpdate } = installUpdateRoleTxMock(conv);

      const result = await service.updateMemberRole(
        uuid(2), // owner
        uuid(1),
        uuid(3), // target
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN },
      );

      expect(result.message).toContain('updated');
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuid(3),
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        }),
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN },
      );
      expect(cacheService.invalidateConversation).toHaveBeenCalledWith(uuid(1));
    });

    it('should reject when non-owner tries to change role', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
          }),
        ],
      });
      installUpdateRoleTxMock(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should reject updating own role', async () => {
      const conv = createMockConversation();
      installUpdateRoleTxMock(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(2), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should reject on direct conversation', async () => {
      const directConv = createMockConversation({
        type: ConversationType.DIRECT,
      });
      installUpdateRoleTxMock(directConv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should throw conflict when conditional UPDATE matches zero rows (concurrent modification)', async () => {
      const conv = createMockConversation();
      const { memberUpdate } = installUpdateRoleTxMock(conv);
      // Simulate the target's role being changed by a concurrent request
      // between the find() and the conditional UPDATE.
      memberUpdate.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should throw not-found when target member is not in the conversation', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
          // uuid(3) intentionally absent
        ],
      });
      installUpdateRoleTxMock(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('should reject promote-to-OWNER and require transferOwnership flow', async () => {
      try {
        await service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.OWNER,
        });
        throw new Error('should have thrown');
      } catch (err: unknown) {
        const response = (
          err as { getResponse?: () => unknown }
        ).getResponse?.();
        expect(response).toMatchObject({
          error: { code: 'OWNER_TRANSFER_REQUIRED' },
        });
      }
      expect(memberRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: UpdateMemberRoleDtoRoleEnum.OWNER }),
      );
    });
  });

  // ─── transferOwnership ────────────────────────────────

  describe('transferOwnership', () => {
    const installTxMock = (conv: ReturnType<typeof createMockConversation>) => {
      const activeMembers = conv.members.filter((m) => m.leftAt === null);
      const memberUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const mockManager = {
        getRepository: jest.fn((entity: unknown) => {
          const entityName = (entity as { name?: string })?.name;
          if (entityName === 'Conversation') {
            return {
              createQueryBuilder: () => ({
                setLock: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(conv),
              }),
            };
          }
          if (entityName === 'ConversationMember') {
            return {
              find: jest.fn().mockResolvedValue(activeMembers),
              update: memberUpdate,
            };
          }
          return {};
        }),
      };

      memberRepository.manager = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (m: unknown) => unknown) => cb(mockManager)),
      };

      return { memberUpdate };
    };

    it('should atomically demote current owner and promote target', async () => {
      const ownerId = uuid(2);
      const targetId = uuid(3);
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: ownerId,
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
          createMockMember({
            id: uuid(8),
            userId: targetId,
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
        ],
      });
      const { memberUpdate } = installTxMock(conv);

      const result = await service.transferOwnership(ownerId, conv.id, {
        targetUserId: targetId,
      });

      expect(result.message).toContain('transferred');
      // Demote current owner to ADMIN.
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ownerId,
          role: UpdateMemberRoleDtoRoleEnum.OWNER,
        }),
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN },
      );
      // Promote target to OWNER.
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: targetId }),
        { role: UpdateMemberRoleDtoRoleEnum.OWNER },
      );
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        'chat.system-message.created',
        expect.objectContaining({ system_event_type: 'owner_transferred' }),
      );
    });

    it('should reject when caller is not OWNER', async () => {
      const callerId = uuid(3);
      const targetId = uuid(4);
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
          createMockMember({
            id: uuid(8),
            userId: callerId,
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
          createMockMember({
            id: uuid(7),
            userId: targetId,
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });
      installTxMock(conv);

      await expect(
        service.transferOwnership(callerId, conv.id, {
          targetUserId: targetId,
        }),
      ).rejects.toThrow();
    });

    it('should reject when target is not an active member', async () => {
      const ownerId = uuid(2);
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: ownerId,
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
        ],
      });
      installTxMock(conv);

      await expect(
        service.transferOwnership(ownerId, conv.id, {
          targetUserId: uuid(9),
        }),
      ).rejects.toThrow();
    });

    it('should reject transferring to self', async () => {
      const ownerId = uuid(2);
      const conv = createMockConversation();
      installTxMock(conv);

      await expect(
        service.transferOwnership(ownerId, conv.id, {
          targetUserId: ownerId,
        }),
      ).rejects.toThrow();
    });
  });

  // ─── updateMySettings ────────────────────────────────

  describe('updateMySettings', () => {
    it('should update nickname and mute settings', async () => {
      const membership = createMockMember();
      memberRepository.findOne.mockResolvedValue(membership);

      const result = await service.updateMySettings(uuid(2), uuid(1), {
        nickname: 'My Nickname',
        isMuted: true,
      });

      expect(result.message).toContain('Settings updated');
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: 'My Nickname',
          isMuted: true,
        }),
      );
    });

    it('should throw when not a member', async () => {
      memberRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateMySettings('outsider', uuid(1), {
          nickname: 'test',
        }),
      ).rejects.toThrow();
    });
  });

  // ─── markAsRead ──────────────────────────────────────

  describe('markAsRead', () => {
    it('should update lastReadAt when marker is older', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      memberRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.markAsRead(uuid(2), uuid(1));

      expect(result.message).toContain('read');
      expect(qb.update).toHaveBeenCalledWith(ConversationMember);
      expect(qb.set).toHaveBeenCalledWith({ lastReadAt: expect.any(Date) });
      expect(qb.where).toHaveBeenCalledWith(
        'conversation_id = :conversationId',
        {
          conversationId: uuid(1),
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('user_id = :userId', {
        userId: uuid(2),
      });
      expect(qb.andWhere).toHaveBeenCalledWith('left_at IS NULL');
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(last_read_at IS NULL OR last_read_at < :readAt)',
        { readAt: expect.any(Date) },
      );
      expect(memberRepository.findOne).not.toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(
        `conversation:unread:${uuid(2)}:${uuid(1)}`,
      );
    });

    it('should return success when membership exists but update is skipped by newer marker', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      memberRepository.createQueryBuilder.mockReturnValue(qb);
      memberRepository.findOne.mockResolvedValue(createMockMember());

      const result = await service.markAsRead(uuid(2), uuid(1));

      expect(result.message).toContain('read');
      expect(memberRepository.findOne).toHaveBeenCalledWith({
        where: { conversationId: uuid(1), userId: uuid(2), leftAt: IsNull() },
      });
      expect(redisClient.del).toHaveBeenCalledWith(
        `conversation:unread:${uuid(2)}:${uuid(1)}`,
      );
    });

    it('should throw when not a member', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      memberRepository.createQueryBuilder.mockReturnValue(qb);
      memberRepository.findOne.mockResolvedValue(null);

      await expect(service.markAsRead('outsider', uuid(1))).rejects.toThrow();
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('should skip update when lastReadAt equals readAt (strict-less-than monotonic guard)', async () => {
      // When lastReadAt === readAt, the condition `last_read_at < :readAt` is false
      // so affected = 0 but the member still exists — treated as idempotent success
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      memberRepository.createQueryBuilder.mockReturnValue(qb);
      memberRepository.findOne.mockResolvedValue(
        createMockMember({ lastReadAt: new Date() }),
      );

      const result = await service.markAsRead(uuid(2), uuid(1));

      expect(result.message).toContain('read');
      expect(redisClient.del).toHaveBeenCalledWith(
        `conversation:unread:${uuid(2)}:${uuid(1)}`,
      );
    });

    it('should update when lastReadAt is null (first-ever read by this member)', async () => {
      // lastReadAt IS NULL satisfies the `last_read_at IS NULL OR ...` condition
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      memberRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.markAsRead(uuid(2), uuid(1));

      expect(result.message).toContain('read');
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(last_read_at IS NULL OR last_read_at < :readAt)',
        { readAt: expect.any(Date) },
      );
      expect(memberRepository.findOne).not.toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(
        `conversation:unread:${uuid(2)}:${uuid(1)}`,
      );
    });
  });
});
