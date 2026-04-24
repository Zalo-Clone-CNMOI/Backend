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
 * The callback is invoked immediately with `mockManager`, so tests can stub
 * `manager.getRepository(Entity)` to return arbitrary per-entity repo mocks.
 *
 * Usage:
 *   installTxMock(pollRepo, (m) => ({
 *     [ConversationPoll.name]: { save: jest.fn() },
 *   }));
 */
export const installTxMock = (
  repo: { manager?: { transaction?: jest.Mock } } & Record<string, any>,
  getRepositoryImpl?: (entity: unknown) => unknown,
) => {
  const mockManager = {
    getRepository: jest.fn((entity: unknown) => {
      if (getRepositoryImpl) return getRepositoryImpl(entity);
      return {};
    }),
    save: jest.fn().mockImplementation((_e: unknown, data: unknown) => data),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    insert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  (repo as any).manager = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (m: unknown) => unknown) => cb(mockManager)),
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
});
