/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — covers CRUD, group/direct
 * conversation lifecycle, membership management, role-based access,
 * cache integration, and edge cases.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationsService } from './conversations.service';
import {
  User,
  Conversation,
  ConversationMember,
} from '@libs/database/entities';
import { CacheService } from '@libs/redis';
import { KAFKA_CLIENT } from '@libs/kafka';

// ─── Mock Enums ──────────────────────────────────────────
const ConversationType = { DIRECT: 'direct', GROUP: 'group' };
const UpdateMemberRoleDtoRoleEnum = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
};

// ─── Helpers ─────────────────────────────────────────────
const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

const createMockMember = (overrides: Record<string, any> = {}) => ({
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

const createMockConversation = (overrides: Record<string, any> = {}) => ({
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

describe('ConversationsService', () => {
  let service: ConversationsService;
  let userRepository: Record<string, jest.Mock>;
  let conversationRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;
  let kafkaClient: Record<string, jest.Mock>;

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
      save: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ ...data, id: data.id || uuid(1) }),
        ),
      createQueryBuilder: jest.fn(),
    };

    memberRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepository,
        },
        { provide: CacheService, useValue: cacheService },
        { provide: KAFKA_CLIENT, useValue: kafkaClient },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
    (service as any).userRepository = userRepository;
    (service as any).conversationRepository = conversationRepository;
    (service as any).memberRepository = memberRepository;
    (service as any).cacheService = cacheService;
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
      } as any);

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
      } as any);

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
      } as any);

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
      conversationRepository.save.mockResolvedValue({ id: uuid(1) });
      conversationRepository.findOne.mockResolvedValue(savedConv);

      await service.createGroupConversation(uuid(2), {
        name: 'New Group',
        memberIds: [uuid(3)],
      } as any);

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
      conversationRepository.save.mockResolvedValue({ id: uuid(1) });
      conversationRepository.findOne.mockResolvedValue(savedConv);

      await service.createGroupConversation(uuid(2), {
        name: 'Test',
        memberIds: [uuid(2), uuid(3), uuid(3)], // duplicates
      } as any);

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
        } as any),
      ).rejects.toThrow();
    });
  });

  // ─── createDirectConversation ─────────────────────────

  describe('createDirectConversation', () => {
    it('should throw when creating DM with yourself', async () => {
      await expect(
        service.createDirectConversation(uuid(2), {
          participantId: uuid(2),
        } as any),
      ).rejects.toThrow();
    });

    it('should throw when target user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createDirectConversation(uuid(2), {
          participantId: uuid(3),
        } as any),
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
      } as any);

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
      } as any);

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
        } as any),
      ).rejects.toThrow();
    });

    it('should reject updates on direct conversations', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.updateConversation(uuid(2), uuid(1), { name: 'New' } as any),
      ).rejects.toThrow();
    });

    it('should reject updates from non-members', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation(),
      );

      await expect(
        service.updateConversation('outsider', uuid(1), { name: 'New' } as any),
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
        service.updateConversation(uuid(2), uuid(1), { name: 'New' } as any),
      ).rejects.toThrow();
    });

    it('should allow OWNER to update group name', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne
        .mockResolvedValueOnce(conv) // first call (update)
        .mockResolvedValueOnce(conv); // reload

      await service.updateConversation(uuid(2), uuid(1), {
        name: 'Updated Group',
      } as any);

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
      } as any);

      expect(memberRepository.save).toHaveBeenCalledWith(
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
        } as any),
      ).rejects.toThrow();
    });

    it('should reject from direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.addMembers(uuid(2), uuid(1), { memberIds: [uuid(4)] } as any),
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
        service.addMembers(uuid(2), uuid(1), { memberIds: [uuid(4)] } as any),
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
      } as any);

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
    it('should set leftAt on membership', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      const result = await service.leaveConversation(uuid(3), uuid(1));

      expect(result.message).toContain('Left');
      expect(memberRepository.save).toHaveBeenCalled();
    });

    it('should reject leaving direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.leaveConversation(uuid(2), uuid(1)),
      ).rejects.toThrow();
    });

    it('should transfer ownership when OWNER leaves', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
            role: UpdateMemberRoleDtoRoleEnum.ADMIN,
          }),
          createMockMember({
            id: uuid(7),
            userId: uuid(4),
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await service.leaveConversation(uuid(2), uuid(1));

      // Should promote admin first
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuid(3),
          role: UpdateMemberRoleDtoRoleEnum.OWNER,
        }),
      );
    });

    it('should promote any member when OWNER leaves and no admin exists', async () => {
      const conv = createMockConversation({
        members: [
          createMockMember({
            userId: uuid(2),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          }),
          createMockMember({
            id: uuid(8),
            userId: uuid(3),
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      await service.leaveConversation(uuid(2), uuid(1));

      // Should promote the remaining member
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuid(3),
          role: UpdateMemberRoleDtoRoleEnum.OWNER,
        }),
      );
    });

    it('should invalidate cache after leaving', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

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
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN } as any,
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
          role: 'admin',
        } as any),
      ).rejects.toThrow();
    });

    it('should reject updating own role', async () => {
      const conv = createMockConversation();
      conversationRepository.findOne.mockResolvedValue(conv);

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(2), {
          role: 'admin',
        } as any),
      ).rejects.toThrow();
    });

    it('should reject on direct conversation', async () => {
      conversationRepository.findOne.mockResolvedValue(
        createMockConversation({ type: ConversationType.DIRECT }),
      );

      await expect(
        service.updateMemberRole(uuid(2), uuid(1), uuid(3), {
          role: 'admin',
        } as any),
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
      } as any);

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
        } as any),
      ).rejects.toThrow();
    });
  });

  // ─── markAsRead ──────────────────────────────────────

  describe('markAsRead', () => {
    it('should set lastReadAt to current date', async () => {
      const membership = createMockMember();
      memberRepository.findOne.mockResolvedValue(membership);

      const result = await service.markAsRead(uuid(2), uuid(1));

      expect(result.message).toContain('read');
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastReadAt: expect.any(Date) }),
      );
    });

    it('should throw when not a member', async () => {
      memberRepository.findOne.mockResolvedValue(null);

      await expect(service.markAsRead('outsider', uuid(1))).rejects.toThrow();
    });
  });
});
