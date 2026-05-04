/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
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
import { installTxMock } from './conversation-poll.service.spec';

describe('ConversationPollService — editPoll', () => {
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

  describe('editPoll', () => {
    const voteRepo = () => voteRepository;
    const optionRepo = () => optionRepository;
    const pollRepo = () => pollRepository;

    it('rejects empty dto', async () => {
      await expect(
        service.editPoll('u1', 'p1', {} as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_NO_EDIT_FIELDS' } },
      });
    });

    it('rejects poll not found', async () => {
      pollRepo().findOne.mockResolvedValueOnce(null);
      await expect(
        service.editPoll('u1', 'p1', { question: 'new' } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('rejects non-creator (even admin)', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'other',
        conversationId: 'c1',
        status: 'active',
      });
      await expect(
        service.editPoll('u1', 'p1', { question: 'new' } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_PERMISSION_DENIED' } },
      });
    });

    it('rejects when poll closed', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'closed',
      });
      await expect(
        service.editPoll('u1', 'p1', { question: 'new' } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_CLOSED' } },
      });
    });

    it('rejects expires_at in past', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
      });
      await expect(
        service.editPoll('u1', 'p1', {
          expires_at: new Date(Date.now() - 10_000).toISOString(),
        } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_EXPIRES_AT_IN_PAST' } },
      });
    });

    it('rejects allow_multiple change when votes exist', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        allowMultiple: false,
      });
      voteRepo().count.mockResolvedValueOnce(3);
      await expect(
        service.editPoll('u1', 'p1', { allow_multiple: true } as any),
      ).rejects.toMatchObject({
        response: {
          error: { message: 'POLL_CANNOT_EDIT_MULTIPLE_WITH_VOTES' },
        },
      });
    });

    it('rejects label edit when option has votes', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        allowMultiple: false,
        allowAddOption: false,
      });
      optionRepo().findOne.mockResolvedValueOnce({
        id: 'o1',
        pollId: 'p1',
        deletedAt: null,
      });
      voteRepo().count.mockResolvedValueOnce(2);
      await expect(
        service.editPoll('u1', 'p1', {
          edited_option_labels: [{ option_id: 'o1', label: 'new' }],
        } as any),
      ).rejects.toMatchObject({
        response: {
          error: { message: 'POLL_CANNOT_EDIT_OPTION_WITH_VOTES' },
        },
      });
    });

    it('rejects label edit when option_id not found in poll', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
      });
      optionRepo().findOne.mockResolvedValueOnce(null);
      await expect(
        service.editPoll('u1', 'p1', {
          edited_option_labels: [{ option_id: 'ghost', label: 'new' }],
        } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_INVALID_OPTION' } },
      });
    });

    it('applies valid edits in a transaction and emits events', async () => {
      const expiresAtIso = new Date(Date.now() + 3600_000).toISOString();
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        allowMultiple: false,
        allowAddOption: false,
        messageId: 'm1',
        question: 'Old q',
      });
      voteRepo().count.mockResolvedValueOnce(0);
      installTxMock(pollRepository, async (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
      });

      const r = await service.editPoll('u1', 'p1', {
        question: 'Updated question',
        allow_multiple: true,
        expires_at: expiresAtIso,
      } as any);

      expect(r.poll_id).toBe('p1');
      expect(r.edited_at).toEqual(expect.any(Number));
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.edited',
        expect.objectContaining({
          poll_id: 'p1',
          editor_user_id: 'u1',
          changes: expect.objectContaining({
            question: 'Updated question',
            allow_multiple: true,
            expires_at: expect.any(Number),
          }),
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('clears expires_at when null passed', async () => {
      pollRepo().findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        allowMultiple: false,
        allowAddOption: false,
        messageId: 'm1',
        question: 'q',
        expiresAt: new Date(),
      });
      installTxMock(pollRepository, async (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
      });

      await service.editPoll('u1', 'p1', { expires_at: null } as any);
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.edited',
        expect.objectContaining({
          changes: expect.objectContaining({ expires_at: null }),
        }),
      );
    });
  });
});
