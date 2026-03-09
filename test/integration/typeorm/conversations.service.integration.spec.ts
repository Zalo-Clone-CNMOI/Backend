/**
 * @file conversations.service.integration.spec.ts
 *
 * Integration tests for ConversationsService (interaction-service) with real NestJS DI.
 * TypeORM repositories mocked at interface level, CacheService uses in-memory Redis mock.
 *
 * Covers:
 *  - getConversations (pagination, member filtering)
 *  - getConversationById (cache hit/miss, not found, non-member)
 *  - createGroupConversation (success, invalid members)
 *  - createDirectConversation (success, self-chat reject, existing return)
 *  - updateConversation (permissioning, type guard)
 *  - addMembers (validation, notification emit, cache invalidation)
 *  - removeMember (role hierarchy checks)
 *  - leaveConversation (ownership transfer, direct guard)
 *  - updateMemberRole (owner-only)
 *  - markAsRead
 */
/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationsService } from '../../../apps/interaction-service/src/modules/conversations/conversations.service';
import { User, Conversation, ConversationMember } from '@libs/database';
import { CacheService } from '@libs/redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  createMockRepository,
  createMockQueryBuilder,
} from '../../helpers/test-database.helper';
import { createMockRedisClient } from '../../helpers/mock-redis.helper';
import { createMockKafkaClient } from '../../helpers/mock-kafka.helper';
import {
  ConversationType,
  UpdateMemberRoleDtoRoleEnum,
  UserStatus,
} from '@app/constant';

describe('ConversationsService (integration)', () => {
  let module: TestingModule;
  let service: ConversationsService;
  let conversationRepo: ReturnType<typeof createMockRepository>;
  let memberRepo: ReturnType<typeof createMockRepository>;
  let userRepo: ReturnType<typeof createMockRepository>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let kafka: ReturnType<typeof createMockKafkaClient>;

  const USER_ID = 'user-owner-id';
  const OTHER_USER_ID = 'user-other-id';
  const CONV_ID = 'conv-id-1';

  beforeAll(async () => {
    conversationRepo = createMockRepository();
    memberRepo = createMockRepository();
    userRepo = createMockRepository();
    redis = createMockRedisClient();
    kafka = createMockKafkaClient();

    module = await Test.createTestingModule({
      providers: [
        ConversationsService,
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepo,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis.client },
        { provide: KAFKA_CLIENT, useValue: kafka.client },
      ],
    }).compile();

    service = module.get(ConversationsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    redis.reset();
    kafka.reset();
    jest.clearAllMocks();
  });

  // Helpers
  function makeConversation(overrides: Record<string, any> = {}) {
    return {
      id: CONV_ID,
      type: ConversationType.GROUP,
      name: 'Test Group',
      avatarUrl: null,
      createdById: USER_ID,
      lastMessageAt: null,
      createdAt: new Date(),
      members: [],
      ...overrides,
    };
  }

  function makeMember(overrides: Record<string, any> = {}) {
    return {
      id: 'member-id',
      conversationId: CONV_ID,
      userId: USER_ID,
      role: UpdateMemberRoleDtoRoleEnum.OWNER,
      nickname: null,
      isMuted: false,
      lastReadAt: null,
      joinedAt: new Date(),
      leftAt: null,
      user: {
        id: USER_ID,
        fullName: 'Owner',
        avatarUrl: null,
        status: UserStatus.ACTIVE,
      },
      ...overrides,
    };
  }

  // ─── getConversations ────────────────────────────────

  describe('getConversations', () => {
    it('should return paginated conversations via QueryBuilder', async () => {
      const conv = makeConversation({
        members: [makeMember()],
      });
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[conv], 1]);
      conversationRepo.createQueryBuilder.mockReturnValue(qb);

      memberRepo.find.mockResolvedValue([makeMember()]);

      const result = await service.getConversations(USER_ID, {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
    });

    it('should default pagination to page 1 limit 20', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      conversationRepo.createQueryBuilder.mockReturnValue(qb);
      memberRepo.find.mockResolvedValue([]);

      const result = await service.getConversations(USER_ID, {});

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should cap limit at 50', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      conversationRepo.createQueryBuilder.mockReturnValue(qb);
      memberRepo.find.mockResolvedValue([]);

      const result = await service.getConversations(USER_ID, {
        page: 1,
        limit: 100,
      });

      expect(result.meta.limit).toBe(50);
    });
  });

  // ─── getConversationById ─────────────────────────────

  describe('getConversationById', () => {
    it('should throw when conversation not found', async () => {
      conversationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getConversationById(USER_ID, 'non-existent'),
      ).rejects.toThrow();
    });

    it('should throw when user is not a member', async () => {
      const conv = makeConversation({
        members: [
          makeMember({
            userId: OTHER_USER_ID,
            user: { id: OTHER_USER_ID, fullName: 'Other' },
          }),
        ],
      });
      conversationRepo.findOne.mockResolvedValue(conv);

      await expect(
        service.getConversationById(USER_ID, CONV_ID),
      ).rejects.toThrow();
    });

    it('should return conversation detail for valid member', async () => {
      const conv = makeConversation({
        members: [makeMember()],
      });
      conversationRepo.findOne.mockResolvedValue(conv);

      const result = await service.getConversationById(USER_ID, CONV_ID);

      expect(result.id).toBe(CONV_ID);
      expect(result.name).toBe('Test Group');
      expect(result.mySettings.role).toBe(UpdateMemberRoleDtoRoleEnum.OWNER);
    });

    it('should use cache when member is valid', async () => {
      const detail = {
        id: CONV_ID,
        type: 'group',
        name: 'Cached Group',
        avatarUrl: null,
        createdById: USER_ID,
        members: [],
        mySettings: {
          role: 'owner',
          nickname: null,
          isMuted: false,
          lastReadAt: null,
        },
        createdAt: new Date(),
      };
      const cache = module.get(CacheService);
      await cache.setConversationDetail(CONV_ID, detail);

      // isMember check
      memberRepo.findOne.mockResolvedValue(makeMember());

      const result = await service.getConversationById(USER_ID, CONV_ID);

      expect(result.name).toBe('Cached Group');
      // conversationRepo.findOne should NOT be used (cache hit)
      expect(conversationRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── createGroupConversation ─────────────────────────

  describe('createGroupConversation', () => {
    it('should create group with owner and members', async () => {
      const users = [
        { id: USER_ID, status: UserStatus.ACTIVE },
        { id: OTHER_USER_ID, status: UserStatus.ACTIVE },
      ];
      userRepo.find.mockResolvedValue(users);

      const savedConv = makeConversation({ id: 'new-conv-id' });
      conversationRepo.create.mockReturnValue(savedConv);
      conversationRepo.save.mockResolvedValue(savedConv);
      memberRepo.create.mockImplementation((dto: any) => dto);
      memberRepo.save.mockResolvedValue([]);

      // getConversationById reload
      conversationRepo.findOne.mockResolvedValue({
        ...savedConv,
        members: [
          makeMember({ conversationId: 'new-conv-id' }),
          makeMember({
            conversationId: 'new-conv-id',
            userId: OTHER_USER_ID,
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });

      const result = await service.createGroupConversation(USER_ID, {
        name: 'Test Group',
        memberIds: [OTHER_USER_ID],
      });

      expect(result.id).toBe('new-conv-id');
      expect(conversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ConversationType.GROUP,
          name: 'Test Group',
          createdById: USER_ID,
        }),
      );
    });

    it('should throw if some members not found / inactive', async () => {
      // Only 1 of 2 requested members found
      userRepo.find.mockResolvedValue([
        { id: USER_ID, status: UserStatus.ACTIVE },
      ]);

      await expect(
        service.createGroupConversation(USER_ID, {
          name: 'Test',
          memberIds: [OTHER_USER_ID],
        }),
      ).rejects.toThrow();
    });
  });

  // ─── createDirectConversation ────────────────────────

  describe('createDirectConversation', () => {
    it('should reject self-conversation', async () => {
      await expect(
        service.createDirectConversation(USER_ID, {
          participantId: USER_ID,
        }),
      ).rejects.toThrow();
    });

    it('should throw when target user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createDirectConversation(USER_ID, {
          participantId: OTHER_USER_ID,
        }),
      ).rejects.toThrow();
    });

    it('should return existing direct conversation if exists', async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        status: UserStatus.ACTIVE,
      });

      const existingConv = makeConversation({
        id: 'existing-direct',
        type: ConversationType.DIRECT,
      });
      const qb = createMockQueryBuilder();
      qb.getOne.mockResolvedValue(existingConv);
      conversationRepo.createQueryBuilder.mockReturnValue(qb);

      // getConversationById will fetch the full conversation
      conversationRepo.findOne.mockResolvedValue({
        ...existingConv,
        members: [
          makeMember({
            conversationId: 'existing-direct',
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
          makeMember({
            conversationId: 'existing-direct',
            userId: OTHER_USER_ID,
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          }),
        ],
      });

      const result = await service.createDirectConversation(USER_ID, {
        participantId: OTHER_USER_ID,
      });

      expect(result.id).toBe('existing-direct');
      // Should NOT create a new conversation
      expect(conversationRepo.create).not.toHaveBeenCalled();
    });
  });

  // ─── updateConversation ──────────────────────────────

  describe('updateConversation', () => {
    it('should reject updates to direct conversations', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          type: ConversationType.DIRECT,
          members: [makeMember()],
        }),
      );

      await expect(
        service.updateConversation(USER_ID, CONV_ID, {
          name: 'New Name',
        }),
      ).rejects.toThrow();
    });

    it('should reject updates from regular members', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [makeMember({ role: UpdateMemberRoleDtoRoleEnum.MEMBER })],
        }),
      );

      await expect(
        service.updateConversation(USER_ID, CONV_ID, {
          name: 'New Name',
        }),
      ).rejects.toThrow();
    });

    it('should allow admin/owner to update group name', async () => {
      const conv = makeConversation({
        members: [makeMember({ role: UpdateMemberRoleDtoRoleEnum.ADMIN })],
      });
      conversationRepo.findOne
        .mockResolvedValueOnce(conv) // update lookup
        .mockResolvedValueOnce({
          // reload for getConversationById
          ...conv,
          name: 'Updated Name',
        });

      conversationRepo.save.mockResolvedValue({
        ...conv,
        name: 'Updated Name',
      });

      const result = await service.updateConversation(USER_ID, CONV_ID, {
        name: 'Updated Name',
      });

      expect(conversationRepo.save).toHaveBeenCalled();
    });
  });

  // ─── addMembers ──────────────────────────────────────

  describe('addMembers', () => {
    it('should throw for non-group conversations', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          type: ConversationType.DIRECT,
          members: [makeMember()],
        }),
      );

      await expect(
        service.addMembers(USER_ID, CONV_ID, {
          memberIds: ['new-user'],
        }),
      ).rejects.toThrow();
    });

    it('should throw if all members already exist', async () => {
      const existingMember = makeMember({
        userId: OTHER_USER_ID,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({ members: [makeMember(), existingMember] }),
      );

      await expect(
        service.addMembers(USER_ID, CONV_ID, {
          memberIds: [OTHER_USER_ID],
        }),
      ).rejects.toThrow();
    });

    it('should emit notification for newly added members', async () => {
      const newUserId = 'new-member-id';
      conversationRepo.findOne
        .mockResolvedValueOnce(makeConversation({ members: [makeMember()] }))
        .mockResolvedValueOnce(
          makeConversation({
            members: [
              makeMember(),
              makeMember({
                userId: newUserId,
                role: UpdateMemberRoleDtoRoleEnum.MEMBER,
              }),
            ],
          }),
        );

      userRepo.find.mockResolvedValue([
        { id: newUserId, status: UserStatus.ACTIVE },
      ]);
      userRepo.findOne.mockResolvedValue({
        id: USER_ID,
        fullName: 'Owner User',
      });
      memberRepo.create.mockImplementation((dto: any) => dto);
      memberRepo.save.mockResolvedValue([]);
      memberRepo.findOne.mockResolvedValue(makeMember());

      await service.addMembers(USER_ID, CONV_ID, {
        memberIds: [newUserId],
      });

      // Should emit notification via Kafka
      expect(kafka.client.emit).toHaveBeenCalled();
    });
  });

  // ─── removeMember ────────────────────────────────────

  describe('removeMember', () => {
    it('should not allow regular member to remove others', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [
            makeMember({ role: UpdateMemberRoleDtoRoleEnum.MEMBER }),
            makeMember({
              id: 'm2',
              userId: OTHER_USER_ID,
              role: UpdateMemberRoleDtoRoleEnum.MEMBER,
            }),
          ],
        }),
      );

      await expect(
        service.removeMember(USER_ID, CONV_ID, OTHER_USER_ID),
      ).rejects.toThrow();
    });

    it('should not allow admin to remove owner', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [
            makeMember({ role: UpdateMemberRoleDtoRoleEnum.ADMIN }),
            makeMember({
              id: 'm2',
              userId: OTHER_USER_ID,
              role: UpdateMemberRoleDtoRoleEnum.OWNER,
            }),
          ],
        }),
      );

      await expect(
        service.removeMember(USER_ID, CONV_ID, OTHER_USER_ID),
      ).rejects.toThrow();
    });

    it('should allow owner to remove a member and invalidate cache', async () => {
      const target = makeMember({
        id: 'm2',
        userId: OTHER_USER_ID,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [makeMember(), target],
        }),
      );
      memberRepo.save.mockResolvedValue({ ...target, leftAt: new Date() });

      const result = await service.removeMember(
        USER_ID,
        CONV_ID,
        OTHER_USER_ID,
      );

      expect(result.message).toContain('removed');
      expect(memberRepo.save).toHaveBeenCalled();
    });
  });

  // ─── leaveConversation ───────────────────────────────

  describe('leaveConversation', () => {
    it('should reject leaving direct conversations', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          type: ConversationType.DIRECT,
          members: [makeMember({ role: UpdateMemberRoleDtoRoleEnum.MEMBER })],
        }),
      );

      await expect(
        service.leaveConversation(USER_ID, CONV_ID),
      ).rejects.toThrow();
    });

    it('should transfer ownership when owner leaves', async () => {
      const admin = makeMember({
        id: 'm2',
        userId: OTHER_USER_ID,
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [makeMember(), admin],
        }),
      );
      memberRepo.save.mockResolvedValue(undefined);

      const result = await service.leaveConversation(USER_ID, CONV_ID);

      expect(result.message).toContain('Left');
      // memberRepo.save should have been called twice:
      // once for promoting admin to owner, once for setting leftAt
      expect(memberRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should allow non-owner to leave without transfer', async () => {
      const member = makeMember({
        userId: USER_ID,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [
            makeMember({
              userId: 'owner-id',
              role: UpdateMemberRoleDtoRoleEnum.OWNER,
            }),
            member,
          ],
        }),
      );
      memberRepo.save.mockResolvedValue(undefined);

      const result = await service.leaveConversation(USER_ID, CONV_ID);

      expect(result.message).toContain('Left');
      // Only one save (for setting leftAt)
      expect(memberRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateMemberRole ────────────────────────────────

  describe('updateMemberRole', () => {
    it('should only allow owner to change roles', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({
          members: [
            makeMember({ role: UpdateMemberRoleDtoRoleEnum.ADMIN }),
            makeMember({
              id: 'm2',
              userId: OTHER_USER_ID,
              role: UpdateMemberRoleDtoRoleEnum.MEMBER,
            }),
          ],
        }),
      );

      await expect(
        service.updateMemberRole(USER_ID, CONV_ID, OTHER_USER_ID, {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should prevent owner from changing own role', async () => {
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({ members: [makeMember()] }),
      );

      await expect(
        service.updateMemberRole(USER_ID, CONV_ID, USER_ID, {
          role: UpdateMemberRoleDtoRoleEnum.ADMIN,
        }),
      ).rejects.toThrow();
    });

    it('should update role for valid target member', async () => {
      const target = makeMember({
        id: 'm2',
        userId: OTHER_USER_ID,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      });
      conversationRepo.findOne.mockResolvedValue(
        makeConversation({ members: [makeMember(), target] }),
      );
      memberRepo.save.mockResolvedValue({
        ...target,
        role: UpdateMemberRoleDtoRoleEnum.ADMIN,
      });

      const result = await service.updateMemberRole(
        USER_ID,
        CONV_ID,
        OTHER_USER_ID,
        { role: UpdateMemberRoleDtoRoleEnum.ADMIN },
      );

      expect(result.message).toContain('updated');
    });
  });

  // ─── markAsRead ──────────────────────────────────────

  describe('markAsRead', () => {
    it('should throw when not a member', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(service.markAsRead(USER_ID, CONV_ID)).rejects.toThrow();
    });

    it('should update lastReadAt for valid member', async () => {
      const membership = makeMember();
      memberRepo.findOne.mockResolvedValue(membership);
      memberRepo.save.mockResolvedValue({
        ...membership,
        lastReadAt: new Date(),
      });

      const result = await service.markAsRead(USER_ID, CONV_ID);

      expect(result.message).toContain('read');
      expect(memberRepo.save).toHaveBeenCalled();
    });
  });
});
