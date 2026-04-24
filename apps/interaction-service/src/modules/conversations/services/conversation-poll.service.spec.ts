/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * @file conversation-poll.service.spec.ts (interaction-service)
 *
 * Unit tests for ConversationPollService.
 *
 * Task 7 scope: only a "should be defined" sanity test + DI wiring fixtures.
 * Tasks 8-10c will add behavioral tests (createPoll, closePoll, addOption,
 * editPoll, removeOption) that reuse the mock repos and `installTxMock`
 * helper defined here.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationPollService } from './conversation-poll.service';
import {
  Conversation,
  ConversationMember,
  ConversationPoll,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';

/**
 * Installs a mock `manager.transaction(cb)` implementation on the given repo.
 * The transaction callback will be invoked with `mockManager`. Tests can
 * optionally provide a `configure` callback to mutate the manager (e.g. set
 * custom `save`/`create`/`getRepository` behavior) before the transaction
 * body runs.
 *
 * Usage (configure pattern):
 *   installTxMock(pollRepo, (mgr) => {
 *     mgr.save = jest.fn().mockResolvedValueOnce({ id: 'x' });
 *     mgr.create = jest.fn().mockImplementation((_e, data) => data);
 *   });
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
  };

  (repo as any).manager = {
    transaction: jest.fn().mockImplementation(async (cb: (m: unknown) => unknown) => {
      if (configure) await configure(mockManager);
      return cb(mockManager);
    }),
  };

  return { mockManager };
};

describe('ConversationPollService', () => {
  let service: ConversationPollService;
  let pollRepository: any;
  let optionRepository: any;
  let voteRepository: any;
  let conversationRepository: any;
  let memberRepository: any;
  let outbox: any;

  beforeEach(async () => {
    const makeRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn().mockImplementation((data: unknown) => data),
      save: jest
        .fn()
        .mockImplementation((data: unknown) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
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

    outbox = {
      publish: jest.fn().mockResolvedValue({ status: 'queued' }),
      publishToTopic: jest.fn().mockResolvedValue({ status: 'queued' }),
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
        { provide: NotificationOutboxPublisher, useValue: outbox },
      ],
    }).compile();

    service = module.get<ConversationPollService>(ConversationPollService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPoll', () => {
    const baseDto = {
      question: 'Pizza or Burger?',
      options: [{ label: 'Pizza' }, { label: 'Burger' }],
    };

    it('rejects non-group conversation', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'direct',
      });
      await expect(
        service.createPoll('u1', 'c1', baseDto as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_NOT_GROUP_CONVERSATION' } },
      });
    });

    it('rejects non-member caller', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.createPoll('u1', 'c1', baseDto as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'CONVERSATION_NOT_MEMBER' } },
      });
    });

    it('rejects fewer than 2 options', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      await expect(
        service.createPoll('u1', 'c1', {
          question: 'q',
          options: [{ label: 'only' }],
        } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_MIN_OPTIONS_REQUIRED' } },
      });
    });

    it('rejects more than 20 options', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      const tooMany = Array.from({ length: 21 }, (_, i) => ({
        label: `opt${i}`,
      }));
      await expect(
        service.createPoll('u1', 'c1', {
          question: 'q',
          options: tooMany,
        } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_OPTION_LIMIT_REACHED' } },
      });
    });

    it('rejects duplicate option labels', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      await expect(
        service.createPoll('u1', 'c1', {
          question: 'q',
          options: [{ label: 'a' }, { label: 'a' }],
        } as any),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_DUPLICATE_OPTION_LABEL' } },
      });
    });

    it('creates poll with options and emits ConversationPollCreated + ChatPollMessageCreated', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      installTxMock(pollRepository, (mgr: any) => {
        mgr.save = jest
          .fn()
          .mockImplementationOnce(async (_e: any, data: any) => ({
            ...data,
            id: 'poll-uuid',
          }))
          .mockImplementationOnce(async (_e: any, arr: any[]) =>
            arr.map((o, i) => ({ ...o, id: `opt-${i}` })),
          );
        mgr.create = jest
          .fn()
          .mockImplementation((_entity: any, data: any) => data);
      });

      const result = await service.createPoll('u1', 'c1', {
        question: 'Pizza or Burger?',
        options: [{ label: 'Pizza' }, { label: 'Burger' }],
        allow_multiple: false,
        allow_add_option: true,
        expires_in_hours: 24,
      } as any);

      expect(result.poll_id).toBe('poll-uuid');
      expect(result.message_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.options).toEqual([
        { option_id: 'opt-0', label: 'Pizza', order_index: 0 },
        { option_id: 'opt-1', label: 'Burger', order_index: 1 },
      ]);
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.created',
        expect.objectContaining({
          poll_id: 'poll-uuid',
          conversation_id: 'c1',
          creator_id: 'u1',
          question: 'Pizza or Burger?',
          allow_multiple: false,
          allow_add_option: true,
          message_id: expect.any(String),
        }),
      );
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'chat.poll-message.created',
        expect.objectContaining({
          message_type: 'poll',
          metadata: expect.objectContaining({
            total_votes: 0,
            total_voters: 0,
            status: 'active',
          }),
        }),
      );
    });

    it('forces is_anonymous=false even if dto says true', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      const savedPoll: any = {};
      installTxMock(pollRepository, (mgr: any) => {
        mgr.create = jest.fn().mockImplementation((_e: any, data: any) => {
          Object.assign(savedPoll, data);
          return data;
        });
        mgr.save = jest
          .fn()
          .mockImplementationOnce(async (_e: any, data: any) => ({
            ...data,
            id: 'p1',
          }))
          .mockImplementationOnce(async (_e: any, arr: any[]) =>
            arr.map((o, i) => ({ ...o, id: `opt-${i}` })),
          );
      });
      await service.createPoll('u1', 'c1', {
        ...baseDto,
        is_anonymous: true,
      } as any);
      expect(savedPoll.isAnonymous).toBe(false);
    });
  });

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
      pollRepository.findOne
        .mockResolvedValueOnce({
          id: 'p1',
          creatorId: 'u1',
          conversationId: 'c1',
          status: 'active',
          messageId: 'm1',
        })
        .mockResolvedValueOnce({
          id: 'p1',
          conversationId: 'c1',
          messageId: 'm1',
          question: 'q',
          options: [],
          status: 'closed',
          allowMultiple: false,
          allowAddOption: false,
          isAnonymous: false,
          expiresAt: null,
          closedAt: new Date(),
          closedReason: 'by_creator',
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
      (pollRepository.manager as any).createQueryBuilder = jest
        .fn()
        .mockReturnValue({
          select: () => ({
            addSelect: () => ({
              from: () => ({
                where: () => ({
                  groupBy: () => ({
                    getRawMany: async () => [{ option_id: 'o1', count: '2' }],
                  }),
                  getRawOne: async () => ({ n: '2' }),
                }),
              }),
            }),
          }),
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
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'chat.poll-message.updated',
        expect.objectContaining({ message_id: 'm1' }),
      );
    });

    it('allows admin to close and forces reason=by_admin', async () => {
      pollRepository.findOne
        .mockResolvedValueOnce({
          id: 'p1',
          creatorId: 'other',
          conversationId: 'c1',
          status: 'active',
          messageId: 'm1',
        })
        .mockResolvedValueOnce({
          id: 'p1',
          conversationId: 'c1',
          messageId: 'm1',
          options: [],
          question: 'q',
          allowMultiple: false,
          allowAddOption: false,
          isAnonymous: false,
          expiresAt: null,
          closedAt: new Date(),
          closedReason: 'by_admin',
          status: 'closed',
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
      (pollRepository.manager as any).createQueryBuilder = jest
        .fn()
        .mockReturnValue({
          select: () => ({
            addSelect: () => ({
              from: () => ({
                where: () => ({
                  groupBy: () => ({ getRawMany: async () => [] }),
                  getRawOne: async () => ({ n: '0' }),
                }),
              }),
            }),
          }),
        });

      const r = await service.closePoll('u1', 'p1');
      expect(r.status).toBe('closed');
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.closed',
        expect.objectContaining({ reason: 'by_admin' }),
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
  });
});
