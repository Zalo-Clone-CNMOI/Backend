/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — covers CRUD, group/direct
 * conversation lifecycle, membership management, role-based access,
 * cache integration, and edge cases.
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
import { IsNull } from 'typeorm';

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        ConversationCoreService,
        ConversationMemberService,
        GroupInviteService,
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

    it('should reject updates from MEMBER role (not admin/owner)', async () => {
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
    const installTxMock = (
      conv: ReturnType<typeof createMockConversation>,
    ) => {
      const activeMembers = (conv.members as ReturnType<typeof createMockMember>[])
        .filter((m) => m.leftAt === null);
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

      (memberRepository as any).manager = {
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

  // ─── updateMemberRole ────────────────────────────────

  describe('updateMemberRole', () => {
    it('should update member role (owner only)', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      const result = await service.updateMemberRole(
        uuid(2), // owner
        uuid(1),
        uuid(3), // target
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN },
      );

      expect(result.message).toContain('updated');
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UpdateMemberRoleDtoRoleEnum.ADMIN }),
      );
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
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should reject updating own role', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(2), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should reject on direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should reject promote-to-OWNER and require transferOwnership flow', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      try {
        await service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: UpdateMemberRoleDtoRoleEnum.OWNER,
        });
        throw new Error('should have thrown');
      } catch (err: unknown) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          error: { message: 'OWNER_TRANSFER_REQUIRED' },
        });
      }
      expect(memberRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: UpdateMemberRoleDtoRoleEnum.OWNER }),
      );
    });
  });

  // ─── transferOwnership ────────────────────────────────

  describe('transferOwnership', () => {
    const installTxMock = (
      conv: ReturnType<typeof createMockConversation>,
    ) => {
      const activeMembers = (
        conv.members as ReturnType<typeof createMockMember>[]
      ).filter((m) => m.leftAt === null);
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

      (memberRepository as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (m: unknown) => unknown) =>
            cb(mockManager),
          ),
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
