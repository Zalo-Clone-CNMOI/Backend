/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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

const ConversationType = { DIRECT: 'direct', GROUP: 'group' };
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

describe('ConversationsService lastMessage projection', () => {
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

  it('should map lastMessage and unreadCount from Redis snapshot', async () => {
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

    redisClient.mGet
      .mockResolvedValueOnce([
        JSON.stringify({
          message_id: 'msg-latest',
          sender_id: uuid(3),
          body: 'Latest preview',
          created_at: 1700000000000,
          has_attachments: false,
          message_type: 'text',
        }),
      ])
      .mockResolvedValueOnce(['7']);

    const result = await service.getConversations(uuid(2), {
      page: 1,
      limit: 20,
    });

    expect(result.items[0].lastMessage).toEqual(
      expect.objectContaining({
        id: 'msg-latest',
        content: 'Latest preview',
        type: 'text',
        senderId: uuid(3),
        senderName: 'Member 2',
        createdAt: new Date(1700000000000),
      }),
    );
    expect(result.items[0].unreadCount).toBe(7);
  });

  it('should keep empty preview body for deleted latest snapshot', async () => {
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

    redisClient.mGet
      .mockResolvedValueOnce([
        JSON.stringify({
          message_id: 'msg-deleted',
          sender_id: uuid(3),
          body: '',
          created_at: 1700000000100,
          has_attachments: false,
          message_type: 'deleted',
        }),
      ])
      .mockResolvedValueOnce(['0']);

    const result = await service.getConversations(uuid(2), {
      page: 1,
      limit: 20,
    });

    expect(result.items[0].lastMessage).toEqual(
      expect.objectContaining({
        id: 'msg-deleted',
        content: '',
        type: 'deleted',
        senderId: uuid(3),
      }),
    );
    expect(result.items[0].unreadCount).toBe(0);
  });

  it('should tolerate invalid Redis JSON and fallback to conversation metadata', async () => {
    const fallbackDate = new Date('2025-01-01T00:00:00.000Z');
    const mockConv = createMockConversation({
      lastMessageId: uuid(3),
      lastMessageAt: fallbackDate,
    });
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

    redisClient.mGet
      .mockResolvedValueOnce(['{broken-json'])
      .mockResolvedValueOnce(['2']);

    const result = await service.getConversations(uuid(2), {
      page: 1,
      limit: 20,
    });

    expect(result.items[0].lastMessage).toEqual({
      id: uuid(3),
      content: 'New messages',
      type: 'unknown',
      senderId: uuid(3),
      senderName: 'Member 2',
      createdAt: fallbackDate,
    });
    expect(result.items[0].unreadCount).toBe(2);
  });

  it('should map attachment-only snapshot to video type for FE rendering', async () => {
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

    redisClient.mGet
      .mockResolvedValueOnce([
        JSON.stringify({
          message_id: 'msg-video',
          sender_id: uuid(3),
          body: '1000042358.mp4',
          created_at: 1700000000999,
          has_attachments: true,
          message_type: 'video',
        }),
      ])
      .mockResolvedValueOnce(['0']);

    const result = await service.getConversations(uuid(2), {
      page: 1,
      limit: 20,
    });

    expect(result.items[0].lastMessage).toEqual(
      expect.objectContaining({
        id: 'msg-video',
        content: '1000042358.mp4',
        type: 'video',
      }),
    );
  });

  it('should fallback attachment snapshot without message_type to unknown', async () => {
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

    redisClient.mGet
      .mockResolvedValueOnce([
        JSON.stringify({
          message_id: 'msg-legacy-attachment',
          sender_id: uuid(3),
          body: 'legacy-file.mp4',
          created_at: 1700000000222,
          has_attachments: true,
        }),
      ])
      .mockResolvedValueOnce(['0']);

    const result = await service.getConversations(uuid(2), {
      page: 1,
      limit: 20,
    });

    expect(result.items[0].lastMessage).toEqual(
      expect.objectContaining({
        id: 'msg-legacy-attachment',
        type: 'unknown',
      }),
    );
  });
});
