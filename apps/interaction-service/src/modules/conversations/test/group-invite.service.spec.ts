/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * @file group-invite.service.spec.ts (interaction-service)
 *
 * Unit tests for GroupInviteService — covers accept/reject/cancel flows,
 * transactional integrity, and event emission through the outbox publisher.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupInviteService } from '../services/group-invite.service';
import { ConversationCoreService } from '../services/conversation-core.service';
import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import { KAFKA_CLIENT, NotificationOutboxPublisher } from '@libs/kafka';
import {
  GroupInviteStatus,
  UpdateMemberRoleDtoRoleEnum,
  ConversationType,
} from '@app/constant';

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

describe('GroupInviteService', () => {
  let service: GroupInviteService;
  let inviteRepository: any;
  let memberRepository: any;
  let conversationRepository: any;
  let userRepository: any;
  let notificationPublisher: any;
  let kafkaClient: any;
  let coreService: any;

  beforeEach(async () => {
    userRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: uuid(2),
        fullName: 'Inviter',
        avatarUrl: null,
      }),
    };

    conversationRepository = {
      findOne: jest.fn().mockResolvedValue({ id: uuid(1), name: 'Test Group' }),
      createQueryBuilder: jest.fn(),
    };

    memberRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(),
    };

    inviteRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(),
      },
    };

    notificationPublisher = {
      publish: jest.fn().mockResolvedValue('queued'),
      publishToTopic: jest.fn().mockResolvedValue('queued'),
    };

    kafkaClient = {
      emit: jest.fn(),
    };

    coreService = {
      createDirectConversation: jest.fn().mockResolvedValue({ id: uuid(7) }),
      getConversationById: jest.fn(),
    };

    const cacheService = {
      invalidateConversation: jest.fn().mockResolvedValue(undefined),
      invalidateConversationList: jest.fn().mockResolvedValue(undefined),
    };

    const redisClient = {
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupInviteService,
        {
          provide: ConversationCoreService,
          useValue: coreService,
        },
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

    service = module.get<GroupInviteService>(GroupInviteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('acceptGroupInvite', () => {
    const buildPendingInvite = () => ({
      id: uuid(3),
      conversationId: uuid(1),
      inviterUserId: uuid(4),
      invitedUserId: uuid(2),
      status: GroupInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 3600_000),
      messageId: uuid(5),
    });

    const buildActiveConversation = () => ({
      id: uuid(1),
      name: 'Test Group',
      type: ConversationType.GROUP,
      createdById: uuid(4),
    });

    const makeMockManager = (opts: {
      invite: any;
      conversation: any;
      insertSpy: jest.Mock;
    }) => ({
      getRepository: jest.fn((entity: any) => {
        if (entity === ConversationInvite) {
          return {
            createQueryBuilder: () => ({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(opts.invite),
            }),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            findOne: jest.fn().mockResolvedValue(opts.invite),
          };
        }
        if (entity === ConversationMember) {
          return {
            createQueryBuilder: () => ({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(null),
            }),
            insert: jest.fn().mockResolvedValue({}),
            save: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          };
        }
        if (entity === Conversation) {
          return {
            createQueryBuilder: () => ({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(opts.conversation),
            }),
          };
        }
        return {};
      }),
      insert: opts.insertSpy,
    });

    it('should NOT insert into non-existent outbox_events table', async () => {
      const insertSpy = jest.fn().mockResolvedValue({});
      const mockManager = makeMockManager({
        invite: buildPendingInvite(),
        conversation: buildActiveConversation(),
        insertSpy,
      });
      inviteRepository.manager.transaction.mockImplementation((cb: any) =>
        cb(mockManager),
      );

      await service.acceptGroupInvite(uuid(2), uuid(1), uuid(3));

      // Must NOT call manager.insert('outbox_events', ...) — that table doesn't exist.
      expect(insertSpy).not.toHaveBeenCalledWith(
        'outbox_events',
        expect.anything(),
      );
    });

    it('should emit GroupInviteAccepted and ConversationMemberAdded via publishToTopic', async () => {
      const insertSpy = jest.fn().mockResolvedValue({});
      const mockManager = makeMockManager({
        invite: buildPendingInvite(),
        conversation: buildActiveConversation(),
        insertSpy,
      });
      inviteRepository.manager.transaction.mockImplementation((cb: any) =>
        cb(mockManager),
      );

      await service.acceptGroupInvite(uuid(2), uuid(1), uuid(3));

      const topics = notificationPublisher.publishToTopic.mock.calls.map(
        (call: any[]) => call[0],
      );
      expect(topics).toEqual(
        expect.arrayContaining([
          expect.stringContaining('invite'),
          expect.stringContaining('member'),
        ]),
      );
    });

    it('should fan out createDirectConversation for all saved invites in parallel', async () => {
      // Build 3 saved invites.
      const savedInvites = [uuid(3), uuid(4), uuid(5)].map(
        (invitedUserId, i) => ({
          id: `00000000-0000-0000-0000-00000000000a${i}`,
          conversationId: uuid(1),
          inviterUserId: uuid(2),
          invitedUserId,
          status: GroupInviteStatus.PENDING,
          expiresAt: new Date(Date.now() + 3600_000),
          messageId: `00000000-0000-0000-0000-00000000000b${i}`,
          message: null,
          createdAt: new Date(),
        }),
      );

      inviteRepository.manager.transaction.mockImplementation(
        (cb: (m: unknown) => unknown) =>
          cb({
            getRepository: jest.fn((entity: unknown) => {
              const name = (entity as { name?: string })?.name;
              if (name === 'Conversation') {
                return {
                  createQueryBuilder: () => ({
                    setLock: jest.fn().mockReturnThis(),
                    where: jest.fn().mockReturnThis(),
                    getOne: () =>
                      Promise.resolve({
                        id: uuid(1),
                        name: 'Test Group',
                        type: ConversationType.GROUP,
                        createdById: uuid(2),
                      }),
                  }),
                };
              }
              if (name === 'ConversationMember') {
                return {
                  findOne: () =>
                    Promise.resolve({
                      userId: uuid(2),
                      role: UpdateMemberRoleDtoRoleEnum.OWNER,
                      leftAt: null,
                    }),
                  find: () =>
                    Promise.resolve([
                      {
                        userId: uuid(2),
                        role: UpdateMemberRoleDtoRoleEnum.OWNER,
                        leftAt: null,
                      },
                    ]),
                };
              }
              if (name === 'User') {
                return {
                  find: () =>
                    Promise.resolve(
                      savedInvites.map((inv) => ({
                        id: inv.invitedUserId,
                        status: 'active',
                      })),
                    ),
                };
              }
              if (name === 'ConversationInvite') {
                return {
                  find: () => Promise.resolve([]),
                  create: (data: unknown) => data,
                  save: () => Promise.resolve(savedInvites),
                };
              }
              return {};
            }),
          }),
      );

      await service.sendGroupInvites(uuid(2), uuid(1), {
        userIds: savedInvites.map((i) => i.invitedUserId),
        message: 'join us',
      });

      expect(coreService.createDirectConversation).toHaveBeenCalledTimes(
        savedInvites.length,
      );
    });

    it('should throw when conversation is disbanded mid-accept', async () => {
      const insertSpy = jest.fn();
      const disbandedConv = {
        ...buildActiveConversation(),
        createdById: null,
      };
      const mockManager = makeMockManager({
        invite: buildPendingInvite(),
        conversation: disbandedConv,
        insertSpy,
      });
      inviteRepository.manager.transaction.mockImplementation((cb: any) =>
        cb(mockManager),
      );

      await expect(
        service.acceptGroupInvite(uuid(2), uuid(1), uuid(3)),
      ).rejects.toThrow();
    });
  });
});
