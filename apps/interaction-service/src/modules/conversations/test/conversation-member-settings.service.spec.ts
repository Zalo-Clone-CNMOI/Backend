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
  });

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
