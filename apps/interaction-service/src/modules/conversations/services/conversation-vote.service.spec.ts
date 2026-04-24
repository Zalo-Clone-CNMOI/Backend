/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * @file conversation-vote.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationVoteService.
 *
 * Task 12 scope: castVote behavioral tests covering validation, lazy-expired
 * close, permission checks, diff computation, and event emission.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConversationMember,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { ConversationVoteService } from './conversation-vote.service';
import { PollMetadataBuilder } from './poll-metadata.builder';

/**
 * Installs a mock `manager.transaction(cb)` implementation on the given repo.
 * Allows tests to mutate the manager (set `findOne`, `find`, `update`,
 * `query`, `createQueryBuilder`, etc.) prior to the tx body running.
 */
export const installTxMock = (
  repo: { manager?: { transaction?: jest.Mock } } & Record<string, any>,
  configure?: (manager: any) => unknown,
) => {
  const mockManager: any = {
    getRepository: jest.fn(() => ({})),
    create: jest.fn().mockImplementation((_e: unknown, data: unknown) => data),
    save: jest.fn().mockImplementation((_e: unknown, data: unknown) => data),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    insert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  (repo as any).manager = {
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: unknown) => unknown) => {
        if (configure) await configure(mockManager);
        return cb(mockManager);
      }),
  };

  return { mockManager };
};

describe('ConversationVoteService', () => {
  let service: ConversationVoteService;
  let pollRepo: any;
  let optionRepo: any;
  let voteRepo: any;
  let memberRepo: any;
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

    pollRepo = makeRepo();
    optionRepo = makeRepo();
    voteRepo = makeRepo();
    memberRepo = makeRepo();

    outbox = {
      publish: jest.fn().mockResolvedValue({ status: 'queued' }),
      publishToTopic: jest.fn().mockResolvedValue({ status: 'queued' }),
    };

    metadataBuilder = {
      build: jest.fn().mockResolvedValue(null),
      emitUpdated: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationVoteService,
        {
          provide: getRepositoryToken(ConversationPoll),
          useValue: pollRepo,
        },
        {
          provide: getRepositoryToken(ConversationPollOption),
          useValue: optionRepo,
        },
        {
          provide: getRepositoryToken(ConversationPollVote),
          useValue: voteRepo,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: memberRepo,
        },
        { provide: NotificationOutboxPublisher, useValue: outbox },
        { provide: PollMetadataBuilder, useValue: metadataBuilder },
      ],
    }).compile();

    service = module.get<ConversationVoteService>(ConversationVoteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('castVote', () => {
    it('rejects empty optionIds', async () => {
      await expect(service.castVote('u1', 'p1', [])).rejects.toMatchObject({
        response: { error: { message: 'VALIDATION_ERROR' } },
      });
    });

    it('rejects poll not found', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce(null);
      });
      await expect(
        service.castVote('u1', 'p1', ['o1']),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_FOUND' } },
      });
    });

    it('rejects when poll closed', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'closed',
          allowMultiple: false,
          conversationId: 'c1',
        });
      });
      await expect(
        service.castVote('u1', 'p1', ['o1']),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_CLOSED' } },
      });
    });

    it('auto-closes expired poll on vote attempt', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: new Date(Date.now() - 10_000),
        });
        mgr.update = jest.fn().mockResolvedValueOnce({ affected: 1 });
      });
      await expect(
        service.castVote('u1', 'p1', ['o1']),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_EXPIRED' } },
      });
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.closed',
        expect.objectContaining({
          reason: 'expired',
          closed_by_user_id: null,
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('rejects >1 option for single-choice poll', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: null,
        });
      });
      await expect(
        service.castVote('u1', 'p1', ['o1', 'o2']),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_SINGLE_CHOICE_VIOLATION' } },
      });
    });

    it('rejects non-member caller', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: null,
        });
      });
      memberRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.castVote('u1', 'p1', ['o1']),
      ).rejects.toMatchObject({
        response: { error: { message: 'CONVERSATION_NOT_MEMBER' } },
      });
    });

    it('rejects invalid option_id', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: null,
        });
        mgr.find = jest
          .fn()
          .mockResolvedValueOnce([{ id: 'o1', pollId: 'p1' }]);
      });
      memberRepo.findOne.mockResolvedValueOnce({ userId: 'u1' });
      await expect(
        service.castVote('u1', 'p1', ['ghost']),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_INVALID_OPTION' } },
      });
    });

    it('single-choice: replaces previous vote', async () => {
      const txMgrQuery: jest.Mock = jest.fn();
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: null,
        });
        mgr.find = jest
          .fn()
          .mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }]);
        txMgrQuery
          .mockResolvedValueOnce([{ option_id: 'o2' }]) // current votes: picked o2
          .mockResolvedValueOnce(undefined); // DELETE result
        mgr.query = txMgrQuery;
        mgr.createQueryBuilder = jest.fn().mockReturnValue({
          insert: () => ({
            into: () => ({
              values: () => ({
                orIgnore: () => ({
                  execute: jest.fn().mockResolvedValue({}),
                }),
              }),
            }),
          }),
        });
      });
      memberRepo.findOne.mockResolvedValueOnce({ userId: 'u1' });

      const r = await service.castVote('u1', 'p1', ['o1']);
      expect(r.option_ids_added).toEqual(['o1']);
      expect(r.option_ids_removed).toEqual(['o2']);
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.vote.cast',
        expect.objectContaining({
          voter_id: 'u1',
          option_ids_added: ['o1'],
          option_ids_removed: ['o2'],
        }),
      );
      expect(metadataBuilder.emitUpdated).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
      );
    });

    it('multi-choice: computes diff correctly', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: true,
          conversationId: 'c1',
          expiresAt: null,
        });
        mgr.find = jest
          .fn()
          .mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]);
        mgr.query = jest
          .fn()
          .mockResolvedValueOnce([
            { option_id: 'o1' },
            { option_id: 'o2' },
          ]) // current: o1, o2
          .mockResolvedValueOnce(undefined); // DELETE
        mgr.createQueryBuilder = jest.fn().mockReturnValue({
          insert: () => ({
            into: () => ({
              values: () => ({
                orIgnore: () => ({
                  execute: jest.fn().mockResolvedValue({}),
                }),
              }),
            }),
          }),
        });
      });
      memberRepo.findOne.mockResolvedValueOnce({ userId: 'u1' });

      // User now wants o2 + o3. Expected diff: added=[o3], removed=[o1]
      const r = await service.castVote('u1', 'p1', ['o2', 'o3']);
      expect(r.option_ids_added).toEqual(['o3']);
      expect(r.option_ids_removed).toEqual(['o1']);
    });

    it('dedupes duplicate option_ids in request', async () => {
      installTxMock(pollRepo, (mgr: any) => {
        mgr.findOne = jest.fn().mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowMultiple: false,
          conversationId: 'c1',
          expiresAt: null,
        });
        mgr.find = jest.fn().mockResolvedValueOnce([{ id: 'o1' }]);
        mgr.query = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(undefined);
        mgr.createQueryBuilder = jest.fn().mockReturnValue({
          insert: () => ({
            into: () => ({
              values: () => ({
                orIgnore: () => ({
                  execute: jest.fn().mockResolvedValue({}),
                }),
              }),
            }),
          }),
        });
      });
      memberRepo.findOne.mockResolvedValueOnce({ userId: 'u1' });

      const r = await service.castVote('u1', 'p1', ['o1', 'o1', 'o1']);
      expect(r.option_ids_added).toEqual(['o1']);
    });
  });
});
