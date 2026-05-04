/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationPollService } from './conversation-poll.service';
import {
  Conversation,
  ConversationMember,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
  User,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { PollMetadataBuilder } from './poll-metadata.builder';

describe('ConversationPollService — listPolls & getPollDetail', () => {
  let service: ConversationPollService;
  let pollRepository: any;
  let optionRepository: any;
  let voteRepository: any;
  let conversationRepository: any;
  let memberRepository: any;
  let userRepository: any;
  let outbox: any;
  let metadataBuilder: { build: jest.Mock; emitUpdated: jest.Mock };

  beforeEach(async () => {
    const makeRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((data: unknown) => data),
      save: jest
        .fn()
        .mockImplementation((data: unknown) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest
        .fn()
        .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(),
      },
    });

    pollRepository = makeRepo();
    optionRepository = makeRepo();
    voteRepository = makeRepo();
    conversationRepository = makeRepo();
    memberRepository = makeRepo();
    userRepository = makeRepo();

    outbox = {
      publish: jest.fn().mockResolvedValue('queued'),
      publishToTopic: jest.fn().mockResolvedValue({ status: 'queued' }),
    };

    metadataBuilder = {
      build: jest.fn().mockResolvedValue(null),
      emitUpdated: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationPollService,
        {
          provide: getRepositoryToken(ConversationPoll),
          useValue: pollRepository,
        },
        {
          provide: getRepositoryToken(ConversationPollOption),
          useValue: optionRepository,
        },
        {
          provide: getRepositoryToken(ConversationPollVote),
          useValue: voteRepository,
        },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        { provide: NotificationOutboxPublisher, useValue: outbox },
        { provide: PollMetadataBuilder, useValue: metadataBuilder },
      ],
    }).compile();

    service = module.get<ConversationPollService>(ConversationPollService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('listPolls', () => {
    it('rejects non-member', async () => {
      memberRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.listPolls('u1', 'c1', {})).rejects.toMatchObject({
        response: { error: { message: 'CONVERSATION_NOT_MEMBER' } },
      });
    });

    it('returns paginated polls', async () => {
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      pollRepository.findAndCount.mockResolvedValueOnce([
        [
          {
            id: 'p1',
            conversationId: 'c1',
            creatorId: 'u2',
            question: 'Q?',
            status: 'active',
            allowMultiple: false,
            allowAddOption: true,
            expiresAt: null,
            closedAt: null,
            createdAt: new Date(1_000),
            options: [
              { id: 'o1', deletedAt: null },
              { id: 'o2', deletedAt: null },
            ],
          },
        ],
        1,
      ] as any);

      const r = await service.listPolls('u1', 'c1', { page: 1, limit: 20 });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toEqual({
        poll_id: 'p1',
        conversation_id: 'c1',
        creator_id: 'u2',
        question: 'Q?',
        status: 'active',
        allow_multiple: false,
        allow_add_option: true,
        expires_at: null,
        closed_at: null,
        created_at: 1_000,
        options_count: 2,
      });
      expect(r.total).toBe(1);
      expect(r.page).toBe(1);
      expect(r.limit).toBe(20);
    });

    it('clamps limit at 50', async () => {
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      pollRepository.findAndCount.mockResolvedValueOnce([[], 0]);
      await service.listPolls('u1', 'c1', { limit: 999 } as any);
      expect(pollRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('respects status filter', async () => {
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      pollRepository.findAndCount.mockResolvedValueOnce([[], 0]);
      await service.listPolls('u1', 'c1', { status: 'closed' as any });
      expect(pollRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId: 'c1',
            status: 'closed',
          }),
        }),
      );
    });
  });

  describe('getPollDetail', () => {
    it('rejects poll not found', async () => {
      pollRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.getPollDetail('u1', 'p1')).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('rejects non-member', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        conversationId: 'c1',
        options: [],
      });
      memberRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.getPollDetail('u1', 'p1')).rejects.toMatchObject({
        response: { error: { message: 'CONVERSATION_NOT_MEMBER' } },
      });
    });

    it('returns detail with my_vote and tally', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        conversationId: 'c1',
        creatorId: 'u2',
        question: 'Q?',
        status: 'active',
        allowMultiple: false,
        allowAddOption: false,
        isAnonymous: false,
        expiresAt: null,
        closedAt: null,
        options: [
          {
            id: 'o1',
            label: 'A',
            orderIndex: 0,
            addedByUserId: 'u2',
            deletedAt: null,
          },
          {
            id: 'o2',
            label: 'B',
            orderIndex: 1,
            addedByUserId: 'u2',
            deletedAt: null,
          },
        ],
      } as any);
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      voteRepository.find.mockResolvedValueOnce([
        { optionId: 'o1', userId: 'u1', pollId: 'p1' },
      ] as any);
      pollRepository.manager.createQueryBuilder = jest.fn().mockReturnValue({
        select: () => ({
          addSelect: () => ({
            from: () => ({
              where: () => ({
                groupBy: () => ({
                  getRawMany: async () => [
                    { option_id: 'o1', count: '3' },
                    { option_id: 'o2', count: '1' },
                  ],
                }),
              }),
            }),
          }),
        }),
      });

      const r = await service.getPollDetail('u1', 'p1');
      expect(r.poll_id).toBe('p1');
      expect(r.my_vote).toEqual(['o1']);
      expect(r.total_votes).toBe(4);
      expect(r.options).toEqual([
        {
          option_id: 'o1',
          label: 'A',
          order_index: 0,
          vote_count: 3,
          added_by_user_id: 'u2',
        },
        {
          option_id: 'o2',
          label: 'B',
          order_index: 1,
          vote_count: 1,
          added_by_user_id: 'u2',
        },
      ]);
    });

    it('filters out soft-deleted options', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        conversationId: 'c1',
        creatorId: 'u2',
        question: 'Q?',
        status: 'active',
        allowMultiple: false,
        allowAddOption: false,
        expiresAt: null,
        closedAt: null,
        options: [
          {
            id: 'o1',
            label: 'A',
            orderIndex: 0,
            addedByUserId: 'u2',
            deletedAt: null,
          },
          {
            id: 'o2',
            label: 'B (deleted)',
            orderIndex: 1,
            addedByUserId: 'u2',
            deletedAt: new Date(),
          },
        ],
      } as any);
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      voteRepository.find.mockResolvedValueOnce([]);
      pollRepository.manager.createQueryBuilder = jest.fn().mockReturnValue({
        select: () => ({
          addSelect: () => ({
            from: () => ({
              where: () => ({
                groupBy: () => ({ getRawMany: async () => [] }),
              }),
            }),
          }),
        }),
      });

      const r = await service.getPollDetail('u1', 'p1');
      expect(r.options).toHaveLength(1);
      expect(r.options[0].option_id).toBe('o1');
    });
  });
});
