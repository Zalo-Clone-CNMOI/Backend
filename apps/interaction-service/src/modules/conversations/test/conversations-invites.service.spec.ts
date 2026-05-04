/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file conversations-invites.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationsService — invite and poll operations:
 * sendGroupInvites, poll passthroughs.
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

  // ─── sendGroupInvites ─────────────────────────────────

  describe('sendGroupInvites', () => {
    it('should direct-add members when join_approval=false (default — no approval needed)', async () => {
      // uuid(2) is already a member in createMockConversation → will be skipped
      // uuid(4) is new → will be added directly
      const conv = createMockConversation({
        settings: { policies: { join_approval: false } },
      });
      conversationRepository.findOne.mockResolvedValue(conv);
      userRepository.find.mockResolvedValue([
        { id: uuid(4), fullName: 'User 4', avatarUrl: null },
      ]);

      const result = await service.sendGroupInvites(uuid(2), uuid(1), {
        userIds: [uuid(2), uuid(4)],
      });

      expect(result).toEqual({
        acceptedCount: 1,
        skippedCount: 1,
        inviteIds: [],
      });
    });

    it('should return acceptedCount=0 skippedCount=N when all userIds are existing members (join_approval=false)', async () => {
      // uuid(2) is OWNER in createMockConversation → already an active member
      const conv = createMockConversation({
        settings: { policies: { join_approval: false } },
      });
      conversationRepository.findOne.mockResolvedValue(conv);

      const result = await service.sendGroupInvites(uuid(2), uuid(1), {
        userIds: [uuid(2)],
      });

      expect(result).toEqual({
        acceptedCount: 0,
        skippedCount: 1,
        inviteIds: [],
      });
    });

    it('should deduplicate userIds before computing skippedCount when join_approval=false', async () => {
      // uuid(4) appears twice → dedup → 2 unique IDs → both added → skippedCount=0
      const conv = createMockConversation({
        settings: { policies: { join_approval: false } },
      });
      conversationRepository.findOne.mockResolvedValue(conv);
      userRepository.find.mockResolvedValue([
        { id: uuid(4), fullName: 'User 4', avatarUrl: null },
        { id: uuid(5), fullName: 'User 5', avatarUrl: null },
      ]);

      const result = await service.sendGroupInvites(uuid(2), uuid(1), {
        userIds: [uuid(4), uuid(4), uuid(5)],
      });

      // Without dedup: skippedCount would be 3-2=1; with dedup it is 2-2=0
      expect(result.skippedCount).toBe(0);
      expect(result.acceptedCount).toBe(2);
      expect(result.inviteIds).toEqual([]);
    });

    it('should route to inviteService (not direct-add) when join_approval=true', async () => {
      const conv = createMockConversation({
        settings: { policies: { join_approval: true } },
      });
      conversationRepository.findOne.mockResolvedValue(conv);
      const spy = jest
        .spyOn(GroupInviteService.prototype, 'sendGroupInvites')
        .mockResolvedValue({
          inviteIds: ['invite-1'],
          acceptedCount: 0,
          skippedCount: 1,
        });

      await service.sendGroupInvites(uuid(2), uuid(1), { userIds: [uuid(4)] });

      expect(spy).toHaveBeenCalledWith(uuid(2), uuid(1), {
        userIds: [uuid(4)],
      });
    });

    it('should direct-add when GROUP has settings=null (null fallback = no approval required)', async () => {
      const conv = createMockConversation({ settings: null });
      conversationRepository.findOne.mockResolvedValue(conv);
      userRepository.find.mockResolvedValue([
        { id: uuid(4), fullName: 'User 4', avatarUrl: null },
      ]);

      const result = await service.sendGroupInvites(uuid(2), uuid(1), {
        userIds: [uuid(4)],
      });

      expect(result.acceptedCount).toBe(1);
      expect(result.inviteIds).toEqual([]);
    });
  });

  // ─── poll passthroughs ────────────────────────────────

  describe('poll passthroughs', () => {
    const userId = uuid(2);
    const convId = uuid(1);
    const pollId = uuid(5);
    const optionId = uuid(6);

    it('createPoll delegates to pollService.createPoll', async () => {
      const dto = {
        question: 'Q?',
        options: [{ label: 'A' }, { label: 'B' }],
      } as unknown as Parameters<typeof service.createPoll>[2];

      const result = await service.createPoll(userId, convId, dto);

      expect(pollService.createPoll).toHaveBeenCalledWith(userId, convId, dto);
      expect(result).toEqual({ poll_id: uuid(5) });
    });

    it('listPolls delegates to pollService.listPolls', async () => {
      const query = { page: 1, limit: 20 };
      await service.listPolls(userId, convId, query);
      expect(pollService.listPolls).toHaveBeenCalledWith(userId, convId, query);
    });

    it('getPollDetail delegates to pollService.getPollDetail', async () => {
      await service.getPollDetail(userId, pollId);
      expect(pollService.getPollDetail).toHaveBeenCalledWith(userId, pollId);
    });

    it('editPoll delegates to pollService.editPoll', async () => {
      const dto = { question: 'New?' };
      await service.editPoll(userId, pollId, dto);
      expect(pollService.editPoll).toHaveBeenCalledWith(userId, pollId, dto);
    });

    it('castPollVote delegates to voteService.castVote', async () => {
      const ids = [optionId];
      await service.castPollVote(userId, pollId, ids);
      expect(voteService.castVote).toHaveBeenCalledWith(userId, pollId, ids);
    });

    it('retractPollVote delegates to voteService.retractVote', async () => {
      await service.retractPollVote(userId, pollId);
      expect(voteService.retractVote).toHaveBeenCalledWith(userId, pollId);
    });

    it('addPollOption delegates to pollService.addOption', async () => {
      await service.addPollOption(userId, pollId, 'Vietnamese');
      expect(pollService.addOption).toHaveBeenCalledWith(
        userId,
        pollId,
        'Vietnamese',
      );
    });

    it('removePollOption delegates to pollService.removeOption', async () => {
      await service.removePollOption(userId, pollId, optionId);
      expect(pollService.removeOption).toHaveBeenCalledWith(
        userId,
        pollId,
        optionId,
      );
    });

    it('closePoll delegates to pollService.closePoll', async () => {
      await service.closePoll(userId, pollId);
      expect(pollService.closePoll).toHaveBeenCalledWith(userId, pollId);
    });
  });
});
