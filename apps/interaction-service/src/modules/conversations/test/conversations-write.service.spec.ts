/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations-write.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — write-side operations:
 * updateConversation, addMembers, removeMember, leaveConversation.
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

describe('ConversationsService — write operations', () => {
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

  // ─── updateConversation ──────────────────────────────

  describe('updateConversation', () => {
    it('should throw when conversation not found', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateConversation(uuid(2), 'nonexistent', {
          name: 'New',
        }),
      ).rejects.toThrow();
    });

    it('should reject updates on direct conversations', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.updateConversation(uuid(2), uuid(1), {
          name: 'New',
        }),
      ).rejects.toThrow();
    });

    it('should reject updates from non-members', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation(),
      );

      await expect(
        service.updateConversation('outsider', uuid(1), {
          name: 'New',
        }),
      ).rejects.toThrow();
    });

    it('should reject MEMBER update when change_info=false', async () => {
      const conv = createMockConversation({
        settings: { permissions: { change_info: false } },
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.updateConversation(uuid(2), uuid(1), {
          name: 'New',
        }),
      ).rejects.toThrow();
    });

    it('should allow OWNER to update group name', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne
        .mockResolvedValueOnce(conv) // first call (update)
        .mockResolvedValueOnce(conv); // reload

      await service.updateConversation(uuid(2), uuid(1), {
        name: 'Updated Group',
      });

      expect(conversationRepository.save).toHaveBeenCalled();
      expect(cacheService.invalidateConversation).toHaveBeenCalled();
    });
  });

  // ─── addMembers ──────────────────────────────────────

  describe('addMembers', () => {
    it('should add new members to group', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne
        .mockResolvedValueOnce(conv) // for addMembers
        .mockResolvedValueOnce(conv); // for reload

      userRepository.find.mockResolvedValue([
        { id: uuid(4), status: 'active' },
      ]);

      await service.addMembers(uuid(2), uuid(1), {
        memberIds: [uuid(4)],
      });

      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.any(Function),
        expect.arrayContaining([
          expect.objectContaining({
            userId: uuid(4),
            role: 'member',
          }),
        ]),
      );
    });

    it('should reject when no new members to add (all already members)', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      // Try to add users who are already members
      await expect(
        service.addMembers(uuid(2), uuid(1), {
          memberIds: [uuid(2), uuid(3)],
        }),
      ).rejects.toThrow();
    });

    it('should reject from direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.addMembers(uuid(2), uuid(1), {
          memberIds: [uuid(4)],
        }),
      ).rejects.toThrow();
    });

    it('should reject from MEMBER role', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.addMembers(uuid(2), uuid(1), {
          memberIds: [uuid(4)],
        }),
      ).rejects.toThrow();
    });

    it('should invalidate cache for all members after adding', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne
        .mockResolvedValueOnce(conv)
        .mockResolvedValueOnce(conv);

      userRepository.find.mockResolvedValue([
        { id: uuid(4), status: 'active' },
      ]);

      await service.addMembers(uuid(2), uuid(1), {
        memberIds: [uuid(4)],
      });

      expect(cacheService.invalidateConversation).toHaveBeenCalled();
    });
  });

  // ─── removeMember ────────────────────────────────────

  describe('removeMember', () => {
    it('should remove member from group', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      await service.removeMember(uuid(2), uuid(1), uuid(3));

      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ leftAt: expect.any(Date) }),
      );
    });

    it('should throw when conversation not found', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeMember(uuid(2), 'nonexistent', uuid(3)),
      ).rejects.toThrow();
    });

    it('should reject from direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.removeMember(uuid(2), uuid(1), uuid(3)),
      ).rejects.toThrow();
    });

    it('should prevent MEMBER from removing others', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.MEMBER, // not admin
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.removeMember(uuid(2), uuid(1), uuid(3)),
      ).rejects.toThrow();
    });

    it('should prevent removing OWNER', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.removeMember(uuid(2), uuid(1), uuid(3)),
      ).rejects.toThrow();
    });

    it('should prevent ADMIN from removing another ADMIN', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.removeMember(uuid(2), uuid(1), uuid(3)),
      ).rejects.toThrow();
    });

    it('should throw when target member not found', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.removeMember(uuid(2), uuid(1), 'nonexistent-member'),
      ).rejects.toThrow();
    });
  });

  // ─── leaveConversation ───────────────────────────────

  describe('leaveConversation', () => {
    // Full behavior is covered in conversation-member.service.spec.ts.
    // This block validates that the facade delegates correctly under the new
    // transactional API.
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
              save: jest.fn().mockResolvedValue({}),
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

    it('should delegate leave flow to memberService via TX', async () => {
      const conv = createMockConversation();
      const { memberUpdate } = installTxMock(conv);

      const result = await service.leaveConversation(uuid(3), uuid(1));

      expect(result.message).toContain('Left');
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuid(3) }),
        expect.objectContaining({ leftAt: expect.any(Date) }),
      );
    });

    it('should reject leaving direct conversation', async () => {
      const directConv = createMockConversation({
        type: ConversationType.DIRECT,
      });
      installTxMock(directConv);

      await expect(
        service.leaveConversation(uuid(2), uuid(1)),
      ).rejects.toThrow();
    });

    it('should invalidate cache after leaving', async () => {
      const conv = createMockConversation();
      installTxMock(conv);

      await service.leaveConversation(uuid(3), uuid(1));

      expect(cacheService.invalidateConversationList).toHaveBeenCalledWith(
        uuid(3),
      );
      expect(cacheService.invalidateConversation).toHaveBeenCalledWith(uuid(1));
    });
  });
});
