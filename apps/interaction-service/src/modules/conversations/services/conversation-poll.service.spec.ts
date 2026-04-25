/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
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
  User,
} from '@libs/database/entities';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { PollMetadataBuilder } from './poll-metadata.builder';

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
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: unknown) => unknown) => {
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

    it('emits NotificationRequested for each non-creator member after createPoll', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      // For buildPollNotifications: list of active members in conversation
      memberRepository.find.mockResolvedValueOnce([
        { userId: 'u1', conversationId: 'c1' },
        { userId: 'u2', conversationId: 'c1' },
        { userId: 'u3', conversationId: 'c1' },
      ]);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'u1',
        fullName: 'Alice',
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
      });

      await service.createPoll('u1', 'c1', {
        question: 'Pizza or Burger?',
        options: [{ label: 'Pizza' }, { label: 'Burger' }],
      } as any);

      // outbox.publish is what enqueueNotifications calls per recipient.
      expect(outbox.publish).toHaveBeenCalledTimes(2);
      const recipients = outbox.publish.mock.calls.map(
        (c: any[]) => c[0].user_id,
      );
      expect(recipients.sort()).toEqual(['u2', 'u3']);

      const sample = outbox.publish.mock.calls[0][0];
      expect(sample).toMatchObject({
        channel: 'push',
        title: 'Alice started a poll',
        body: 'Pizza or Burger?',
        type: 'group_poll',
        data: { poll_id: 'poll-uuid', conversation_id: 'c1' },
        rich: expect.objectContaining({
          category: 'group_poll',
          thread_id: 'c1',
        }),
      });
    });

    it('does not throw if notification dispatch fails', async () => {
      conversationRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        type: 'group',
      });
      memberRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
        conversationId: 'c1',
      });
      memberRepository.find.mockRejectedValueOnce(new Error('db boom'));
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
      });

      await expect(
        service.createPoll('u1', 'c1', {
          question: 'q',
          options: [{ label: 'a' }, { label: 'b' }],
        } as any),
      ).resolves.toMatchObject({ poll_id: 'poll-uuid' });
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
