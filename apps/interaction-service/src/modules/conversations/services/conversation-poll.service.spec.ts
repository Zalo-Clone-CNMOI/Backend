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
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((data: unknown) => data),
      save: jest
        .fn()
        .mockImplementation((data: unknown) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
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

  describe('addOption', () => {
    it('rejects empty label', async () => {
      await expect(
        service.addOption('u1', 'p1', '   '),
      ).rejects.toMatchObject({
        response: { error: { message: 'VALIDATION_ERROR' } },
      });
    });

    it('rejects poll not found', async () => {
      pollRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.addOption('u1', 'p1', 'new'),
      ).rejects.toMatchObject({
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
      await expect(
        service.addOption('u1', 'p1', 'new'),
      ).rejects.toMatchObject({
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
      await expect(
        service.addOption('u1', 'p1', 'new'),
      ).rejects.toMatchObject({
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
      await expect(
        service.addOption('u1', 'p1', 'new'),
      ).rejects.toMatchObject({
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
      await expect(
        service.addOption('u1', 'p1', 'new'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_OPTION_LIMIT_REACHED' } },
      });
    });

    it('inserts option and emits events', async () => {
      pollRepository.findOne
        .mockResolvedValueOnce({
          id: 'p1',
          status: 'active',
          allowAddOption: true,
          conversationId: 'c1',
          messageId: 'm1',
        })
        .mockResolvedValueOnce({
          id: 'p1',
          conversationId: 'c1',
          messageId: 'm1',
          options: [],
          question: 'q',
          allowMultiple: false,
          allowAddOption: true,
          isAnonymous: false,
          status: 'active',
          expiresAt: null,
          closedAt: null,
          closedReason: null,
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
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'chat.poll-message.updated',
        expect.any(Object),
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
      await expect(
        service.addOption('u1', 'p1', 'dup'),
      ).rejects.toMatchObject({
        response: { error: { message: 'POLL_DUPLICATE_OPTION_LABEL' } },
      });
    });
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
      pollRepo()
        .findOne.mockResolvedValueOnce({
          id: 'p1',
          creatorId: 'u1',
          conversationId: 'c1',
          status: 'active',
          allowMultiple: false,
          allowAddOption: false,
          messageId: 'm1',
          question: 'Old q',
        })
        .mockResolvedValueOnce({
          id: 'p1',
          conversationId: 'c1',
          messageId: 'm1',
          options: [],
          question: 'Updated question',
          allowMultiple: true,
          allowAddOption: false,
          isAnonymous: false,
          status: 'active',
          expiresAt: new Date(expiresAtIso),
          closedAt: null,
          closedReason: null,
        });
      voteRepo().count.mockResolvedValueOnce(0);
      installTxMock(pollRepository, async (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
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
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'chat.poll-message.updated',
        expect.any(Object),
      );
    });

    it('clears expires_at when null passed', async () => {
      pollRepo()
        .findOne.mockResolvedValueOnce({
          id: 'p1',
          creatorId: 'u1',
          conversationId: 'c1',
          status: 'active',
          allowMultiple: false,
          allowAddOption: false,
          messageId: 'm1',
          question: 'q',
          expiresAt: new Date(),
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
          status: 'active',
          expiresAt: null,
          closedAt: null,
          closedReason: null,
        });
      installTxMock(pollRepository, async (mgr: any) => {
        mgr.update = jest.fn().mockResolvedValue({ affected: 1 });
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

      await service.editPoll('u1', 'p1', { expires_at: null } as any);
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'conversation.poll.edited',
        expect.objectContaining({
          changes: expect.objectContaining({ expires_at: null }),
        }),
      );
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
          options: [],
          question: 'q',
          allowMultiple: false,
          allowAddOption: false,
          isAnonymous: false,
          status: 'active',
          expiresAt: null,
          closedAt: null,
          closedReason: null,
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
      expect(outbox.publishToTopic).toHaveBeenCalledWith(
        'chat.poll-message.updated',
        expect.any(Object),
      );
    });
  });
});
