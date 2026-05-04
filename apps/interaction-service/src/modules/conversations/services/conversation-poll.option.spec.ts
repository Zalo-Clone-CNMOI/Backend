/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
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

describe('ConversationPollService — addOption & removeOption', () => {
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

  describe('addOption', () => {
    it('rejects empty label', async () => {
      await expect(service.addOption('u1', 'p1', '   ')).rejects.toMatchObject({
        response: { error: { message: 'VALIDATION_ERROR' } },
      });
    });

    it('rejects poll not found', async () => {
      pollRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.addOption('u1', 'p1', 'new')).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('rejects when poll closed', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'closed',
        allowAddOption: true,
        conversationId: 'c1',
      });
      await expect(service.addOption('u1', 'p1', 'new')).rejects.toMatchObject({
        response: { error: { message: 'POLL_CLOSED' } },
      });
    });

    it('rejects when allow_add_option=false', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'active',
        allowAddOption: false,
        conversationId: 'c1',
      });
      await expect(service.addOption('u1', 'p1', 'new')).rejects.toMatchObject({
        response: { error: { message: 'POLL_ADD_OPTION_NOT_ALLOWED' } },
      });
    });

    it('rejects when caller not a member', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'active',
        allowAddOption: true,
        conversationId: 'c1',
      });
      memberRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.addOption('u1', 'p1', 'new')).rejects.toMatchObject({
        response: { error: { message: 'CONVERSATION_NOT_MEMBER' } },
      });
    });

    it('rejects when 20 options exist', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'active',
        allowAddOption: true,
        conversationId: 'c1',
      });
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      optionRepository.count.mockResolvedValueOnce(20);
      await expect(service.addOption('u1', 'p1', 'new')).rejects.toMatchObject({
        response: { error: { message: 'POLL_OPTION_LIMIT_REACHED' } },
      });
    });

    it('inserts option and emits events', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'active',
        allowAddOption: true,
        conversationId: 'c1',
        messageId: 'm1',
      });
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      optionRepository.count.mockResolvedValueOnce(3);
      optionRepository.create.mockImplementation((d: any) => d);
      optionRepository.save.mockResolvedValueOnce({
        id: 'opt4',
        label: 'newOpt',
        orderIndex: 3,
        addedByUserId: 'u1',
        pollId: 'p1',
      });

      const r = await service.addOption('u1', 'p1', 'newOpt');
      expect(r).toEqual({
        option_id: 'opt4',
        label: 'newOpt',
        order_index: 3,
      });
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.option.added',
        expect.objectContaining({
          poll_id: 'p1',
          option_id: 'opt4',
          label: 'newOpt',
          order_index: 3,
          added_by_user_id: 'u1',
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('rejects duplicate label (Postgres 23505)', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'active',
        allowAddOption: true,
        conversationId: 'c1',
      });
      memberRepository.findOne.mockResolvedValueOnce({ userId: 'u1' });
      optionRepository.count.mockResolvedValueOnce(3);
      optionRepository.create.mockImplementation((d: any) => d);
      const err: any = new Error('duplicate');
      err.code = '23505';
      optionRepository.save.mockRejectedValueOnce(err);
      await expect(service.addOption('u1', 'p1', 'dup')).rejects.toMatchObject({
        response: { error: { message: 'POLL_DUPLICATE_OPTION_LABEL' } },
      });
    });
  });

  describe('removeOption', () => {
    it('rejects poll not found', async () => {
      pollRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.removeOption('u1', 'p1', 'o1'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('rejects non-creator', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'other',
        conversationId: 'c1',
        status: 'active',
      });
      await expect(
        service.removeOption('u1', 'p1', 'o1'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_PERMISSION_DENIED' } },
      });
    });

    it('rejects when poll closed', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'closed',
      });
      await expect(
        service.removeOption('u1', 'p1', 'o1'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_CLOSED' } },
      });
    });

    it('rejects when option not found in poll', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
      });
      optionRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.removeOption('u1', 'p1', 'ghost'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_INVALID_OPTION' } },
      });
    });

    it('rejects when option has votes', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
      });
      optionRepository.findOne.mockResolvedValueOnce({
        id: 'o1',
        pollId: 'p1',
        deletedAt: null,
      });
      voteRepository.count.mockResolvedValueOnce(1);
      await expect(
        service.removeOption('u1', 'p1', 'o1'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_CANNOT_EDIT_OPTION_WITH_VOTES' } },
      });
    });

    it('rejects when removing would leave < 2 options', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
      });
      optionRepository.findOne.mockResolvedValueOnce({
        id: 'o1',
        pollId: 'p1',
        deletedAt: null,
      });
      voteRepository.count.mockResolvedValueOnce(0);
      optionRepository.count.mockResolvedValueOnce(2);
      await expect(
        service.removeOption('u1', 'p1', 'o1'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_MIN_OPTIONS_REQUIRED' } },
      });
    });

    it('soft-deletes and emits events when valid', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        messageId: 'm1',
      });
      optionRepository.findOne.mockResolvedValueOnce({
        id: 'o1',
        pollId: 'p1',
        deletedAt: null,
      });
      voteRepository.count.mockResolvedValueOnce(0);
      optionRepository.count.mockResolvedValueOnce(3);
      optionRepository.softDelete.mockResolvedValueOnce({
        affected: 1,
        raw: [],
        generatedMaps: [],
      } as any);

      const r = await service.removeOption('u1', 'p1', 'o1');
      expect(r).toEqual({ option_id: 'o1' });
      expect(optionRepository.softDelete).toHaveBeenCalledWith({ id: 'o1' });
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.option.removed',
        expect.objectContaining({
          poll_id: 'p1',
          option_id: 'o1',
          removed_by_user_id: 'u1',
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });
  });
});
