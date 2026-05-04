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

describe('ConversationPollService — closePoll', () => {
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

  const installCloseTxMock = (rows: any[] = []) => {
    installTxMock(pollRepository, (mgr: any) => {
      mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
      mgr.createQueryBuilder = jest.fn().mockReturnValue({
        select: () => ({
          addSelect: () => ({
            from: () => ({
              where: () => ({
                groupBy: () => ({ getRawMany: async () => rows }),
              }),
            }),
          }),
        }),
      });
    });
  };

  describe('closePoll', () => {
    it('returns POLL_NOT_FOUND when poll missing', async () => {
      pollRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.closePoll('u1', 'p1')).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('is idempotent when poll already closed', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'closed',
      });
      const r = await service.closePoll('u1', 'p1');
      expect(r.status).toBe('closed');
      expect(r.final_tally).toEqual([]);
      expect(outbox.publishToTopic).not.toHaveBeenCalled();
    });

    it('rejects when caller is not creator, admin, or owner', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'other',
        conversationId: 'c1',
        status: 'active',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        role: 'member',
      });
      await expect(service.closePoll('u1', 'p1')).rejects.toMatchObject({
        response: { error: { message: 'POLL_PERMISSION_DENIED' } },
      });
    });

    it('allows creator to close and emits ConversationPollClosed + ChatPollMessageUpdated', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        messageId: 'm1',
      });
      installTxMock(pollRepository, (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
        mgr.createQueryBuilder = jest.fn().mockReturnValue({
          select: () => ({
            addSelect: () => ({
              from: () => ({
                where: () => ({
                  groupBy: () => ({
                    getRawMany: async () => [{ option_id: 'o1', count: '2' }],
                  }),
                }),
              }),
            }),
          }),
        });
      });

      const r = await service.closePoll('u1', 'p1');
      expect(r.status).toBe('closed');
      expect(r.final_tally).toEqual([{ option_id: 'o1', vote_count: 2 }]);
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.closed',
        expect.objectContaining({
          poll_id: 'p1',
          reason: 'by_creator',
          closed_by_user_id: 'u1',
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('allows admin to close and forces reason=by_admin', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'other',
        conversationId: 'c1',
        status: 'active',
        messageId: 'm1',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        role: 'admin',
      });
      installTxMock(pollRepository, (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
        mgr.createQueryBuilder = jest.fn().mockReturnValue({
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
      });

      const r = await service.closePoll('u1', 'p1');
      expect(r.status).toBe('closed');
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.closed',
        expect.objectContaining({ reason: 'by_admin' }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('throws CONFLICT on race when update affects 0 rows', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        messageId: 'm1',
      });
      installTxMock(pollRepository, (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 0 });
      });
      await expect(service.closePoll('u1', 'p1')).rejects.toMatchObject({
        response: { error: { message: 'POLL_CLOSED' } },
      });
    });

    it('emits notifications with by_creator title when creator closes', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        question: 'Pizza or Burger?',
        messageId: 'm1',
      });
      memberRepository.find.mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'u1',
        fullName: 'Alice',
      });
      installCloseTxMock();

      await service.closePoll('u1', 'p1');

      expect(outbox.publish).toHaveBeenCalledTimes(2);
      const sample = outbox.publish.mock.calls[0][0];
      expect(sample).toMatchObject({
        channel: 'push',
        title: 'Alice ended the poll',
        body: 'Pizza or Burger?',
        type: 'group_poll_closed',
        data: { poll_id: 'p1', conversation_id: 'c1' },
      });
      const recipients = outbox.publish.mock.calls.map(
        (c: any[]) => c[0].user_id,
      );
      expect(recipients).not.toContain('u1');
      expect(recipients.sort()).toEqual(['u2', 'u3']);
    });

    it('emits notifications with by_admin title when admin closes', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'creator',
        conversationId: 'c1',
        status: 'active',
        question: 'Q?',
        messageId: 'm1',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'admin1',
        role: 'admin',
      });
      memberRepository.find.mockResolvedValueOnce([
        { userId: 'admin1' },
        { userId: 'creator' },
        { userId: 'u3' },
      ]);
      installCloseTxMock();

      await service.closePoll('admin1', 'p1');

      expect(outbox.publish).toHaveBeenCalledTimes(2);
      const sample = outbox.publish.mock.calls[0][0];
      expect(sample.title).toBe('An admin ended the poll');
      // No user lookup for by_admin path
      expect(userRepository.findOne).not.toHaveBeenCalled();
      const recipients = outbox.publish.mock.calls.map(
        (c: any[]) => c[0].user_id,
      );
      expect(recipients).not.toContain('admin1');
    });

    it('emits notifications with generic title when reason=expired', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        question: 'Q?',
        messageId: 'm1',
      });
      memberRepository.find.mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      installCloseTxMock();

      await service.closePoll('u1', 'p1', 'expired' as any);

      expect(outbox.publish).toHaveBeenCalledTimes(2);
      const titles = outbox.publish.mock.calls.map((c: any[]) => c[0].title);
      titles.forEach((t: string) => expect(t).toBe('Poll has ended'));
      expect(userRepository.findOne).not.toHaveBeenCalled();
      const recipients = outbox.publish.mock.calls.map(
        (c: any[]) => c[0].user_id,
      );
      expect(recipients.sort()).toEqual(['u1', 'u2']);
    });

    it('does not throw if notification dispatch fails on close', async () => {
      pollRepository.findOne.mockResolvedValueOnce({
        id: 'p1',
        creatorId: 'u1',
        conversationId: 'c1',
        status: 'active',
        question: 'Q?',
        messageId: 'm1',
      });
      memberRepository.find.mockRejectedValueOnce(new Error('db boom'));
      installCloseTxMock();

      const r = await service.closePoll('u1', 'p1');
      expect(r.status).toBe('closed');
    });
  });
});
