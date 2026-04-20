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
import { ConversationCoreService } from '../services/conversation-core.service';
import { ConversationMemberService } from '../services/conversation-member.service';
import { GroupInviteService } from '../services/group-invite.service';
import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import { KAFKA_CLIENT, NotificationOutboxPublisher } from '@libs/kafka';
import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';

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

describe('ConversationsService', () => {
  let service: ConversationsService;
  let userRepository: Record<string, jest.Mock>;
  let conversationRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;
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
});
