/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — covers read operations and conversation
 * creation: getConversations, getConversationById, createGroupConversation,
 * createDirectConversation.
 *
 * Write operations → conversations-write.service.spec.ts
 * Admin/role operations → conversations-admin.service.spec.ts
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

describe('ConversationsService', () => {
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

  // ─── getConversations ──────────────────────────────────

  describe('getConversations', () => {
    it('should return paginated list of conversations', async () => {
      const mockConv = createMockConversation();
      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockConv], 1]),
      };
      conversationRepository.createQueryBuilder.mockReturnValue(mockQb);
      memberRepository.find.mockResolvedValue([
        createMockMember({ conversationId: uuid(1), userId: uuid(2) }),
      ]);

      const result = await service.getConversations(uuid(2), {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should cap limit at 50', async () => {
      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      conversationRepository.createQueryBuilder.mockReturnValue(mockQb);
      memberRepository.find.mockResolvedValue([]);

      const result = await service.getConversations(uuid(2), {
        page: 1,
        limit: 200,
      });

      expect(result.meta.limit).toBe(50);
    });

    it('should show other user name for direct conversations', async () => {
      const directConv = createMockConversation({
        type: ConversationType.DIRECT,
        name: null,
        members: [
          createMockMember({
            userId: 'me',
            user: { id: 'me', fullName: 'Me', avatarUrl: null },
          }),
          createMockMember({
            userId: 'other',
            user: {
              id: 'other',
              fullName: 'Other Person',
              avatarUrl: 'avatar.jpg',
            },
          }),
        ],
      });

      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[directConv], 1]),
      };
      conversationRepository.createQueryBuilder.mockReturnValue(mockQb);
      memberRepository.find.mockResolvedValue([]);

      const result = await service.getConversations('me', {
        page: 1,
        limit: 20,
      });

      expect(result.items[0].name).toBe('Other Person');
      expect(result.items[0].avatarUrl).toBe('avatar.jpg');
    });
  });

  // ─── getConversationById ──────────────────────────────

  describe('getConversationById', () => {
    it('should return cached conversation when member', async () => {
      const cached = { id: uuid(1), name: 'Cached Conv' };
      cacheService.getConversationDetail.mockResolvedValue(cached);
      memberRepository.findOne.mockResolvedValue(createMockMember());

      const result = await service.getConversationById(uuid(2), uuid(1));

      expect(result).toEqual(cached);
      expect(conversationRepository.findOne).not.toHaveBeenCalled();
    });

    it('should invalidate cache when cached but user is NOT a member', async () => {
      cacheService.getConversationDetail.mockResolvedValue({ id: uuid(1) });
      memberRepository.findOne.mockResolvedValue(null);

      // Will fail because findOne on conversationRepository is null after cache invalidation
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getConversationById('non-member', uuid(1)),
      ).rejects.toThrow();

      expect(cacheService.invalidateConversation).toHaveBeenCalledWith(uuid(1));
    });

    it('should throw when conversation not found in DB', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getConversationById(uuid(2), 'nonexistent'),
      ).rejects.toThrow();
    });

    it('should throw when user is not a member', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      // User is not in members list
      await expect(
        service.getConversationById('outsider', uuid(1)),
      ).rejects.toThrow();
    });

    it('should cache result after DB query', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      await service.getConversationById(uuid(2), uuid(1));

      expect(cacheService.setConversationDetail).toHaveBeenCalledWith(
        uuid(1),
        expect.objectContaining({ id: uuid(1) }),
      );
    });
  });

  // ─── createGroupConversation ──────────────────────────

  describe('createGroupConversation', () => {
    it('should create group with creator as OWNER', async () => {
      const users = [
        { id: uuid(2), status: 'active' },
        { id: uuid(3), status: 'active' },
      ];
      userRepository.find.mockResolvedValue(users);

      // Mock the reload via getConversationById
      const savedConv = createMockConversation();
      conversationRepository.save.mockResolvedValue({
        id: uuid(1),
        createdAt: new Date(),
      });
      conversationRepository.findOne.mockResolvedValue(savedConv);

      await service.createGroupConversation(uuid(2), {
        name: 'New Group',
        memberIds: [uuid(3)],
      });

      expect(conversationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'group',
          name: 'New Group',
          createdById: uuid(2),
        }),
      );
    });

    it('should deduplicate member IDs (creator always included)', async () => {
      userRepository.find.mockResolvedValue([
        { id: uuid(2), status: 'active' },
        { id: uuid(3), status: 'active' },
      ]);

      const savedConv = createMockConversation();
      conversationRepository.save.mockResolvedValue({
        id: uuid(1),
        createdAt: new Date(),
      });
      conversationRepository.findOne.mockResolvedValue(savedConv);

      await service.createGroupConversation(uuid(2), {
        name: 'Test',
        memberIds: [uuid(2), uuid(3), uuid(3)], // duplicates
      });

      // Should save exactly 2 members after dedup
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: uuid(2) }),
          expect.objectContaining({ userId: uuid(3) }),
        ]),
      );
    });

    it('should throw when some users not found', async () => {
      // Only 1 user found instead of 2
      userRepository.find.mockResolvedValue([
        { id: uuid(2), status: 'active' },
      ]);

      await expect(
        service.createGroupConversation(uuid(2), {
          name: 'Test',
          memberIds: [uuid(3)],
        }),
      ).rejects.toThrow();
    });
  });

  // ─── createDirectConversation ─────────────────────────

  describe('createDirectConversation', () => {
    it('should throw when creating DM with yourself', async () => {
      await expect(
        service.createDirectConversation(uuid(2), {
          participantId: uuid(2),
        }),
      ).rejects.toThrow();
    });

    it('should throw when target user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createDirectConversation(uuid(2), {
          participantId: uuid(3),
        }),
      ).rejects.toThrow();
    });

    it('should return existing DM if already exists', async () => {
      userRepository.findOne.mockResolvedValue({
        id: uuid(3),
        status: 'active',
      });

      const existingQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-conv' }),
      };
      conversationRepository.createQueryBuilder.mockReturnValue(existingQb);

      // Mock getConversationById for reload
      const conv = createMockConversation({ id: 'existing-conv' });
      conversationRepository.findOne.mockResolvedValue(conv);

      const result = await service.createDirectConversation(uuid(2), {
        participantId: uuid(3),
      });

      expect(result).toBeDefined();
      // Should NOT create a new conversation
      expect(conversationRepository.create).not.toHaveBeenCalled();
    });

    it('should create new DM when none exists', async () => {
      userRepository.findOne.mockResolvedValue({
        id: uuid(3),
        status: 'active',
      });

      const existingQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null), // no existing DM
      };
      conversationRepository.createQueryBuilder.mockReturnValue(existingQb);

      conversationRepository.save.mockResolvedValue({ id: uuid(1) });

      // For the reload
      const conv = createMockConversation({ type: ConversationType.DIRECT });
      conversationRepository.findOne.mockResolvedValue(conv);

      await service.createDirectConversation(uuid(2), {
        participantId: uuid(3),
      });

      expect(conversationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'direct',
          name: null,
          createdById: uuid(2),
        }),
      );
      // Both users should be MEMBER role
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: uuid(2), role: 'member' }),
          expect.objectContaining({ userId: uuid(3), role: 'member' }),
        ]),
      );
    });
  });
});
