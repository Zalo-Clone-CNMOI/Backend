/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test } from '@nestjs/testing';
import { CallConsumer } from './call.consumer';
import { CallStateStore } from './call-state.store';
import { CallEventsPublisher } from './call-events.publisher';
import { CallMembershipAccessService } from './call-membership-access.service';
import { CallTimeoutService } from './call-timeout.service';
import { CallHistoryService } from './call-history.service';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { KAFKA_CLIENT } from '@libs/kafka';
import { KafkaTopics } from '@libs/contracts';

describe('CallConsumer — VoIP push outbox', () => {
  let consumer: CallConsumer;
  let outbox: any;
  let stateStore: any;
  let membershipAccess: any;
  let kafkaClient: any;
  let timeoutService: any;
  let historyService: any;

  beforeEach(async () => {
    outbox = { publishToTopic: jest.fn().mockResolvedValue('queued') };
    stateStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    membershipAccess = { ensureMember: jest.fn().mockResolvedValue(true) };
    kafkaClient = { emit: jest.fn() };
    timeoutService = {
      scheduleTimeout: jest.fn().mockResolvedValue(undefined),
      cancelTimeout: jest.fn().mockResolvedValue(undefined),
    };
    historyService = {
      createSession: jest.fn().mockResolvedValue(undefined),
      closeSession: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        CallConsumer,
        { provide: KAFKA_CLIENT, useValue: kafkaClient },
        { provide: CallStateStore, useValue: stateStore },
        {
          provide: CallEventsPublisher,
          useValue: {
            publishStateUpdate: jest.fn(),
            publishNotMemberUpdate: jest.fn(),
            publishCallNotFoundUpdate: jest.fn(),
          },
        },
        { provide: CallMembershipAccessService, useValue: membershipAccess },
        { provide: CallTimeoutService, useValue: timeoutService },
        { provide: CallHistoryService, useValue: historyService },
        { provide: NotificationOutboxPublisher, useValue: outbox },
      ],
    }).compile();
    consumer = module.get(CallConsumer);
  });

  afterEach(() => jest.clearAllMocks());

  it('publishes CallStarted to outbox with push_recipient_ids on call start', async () => {
    await consumer.onCallStart({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      initiator_id: 'user-1',
      call_type: 'audio',
      participant_ids: ['user-2'],
      started_at: Date.now(),
      trace_id: 'trace-1',
    });
    expect(outbox.publishToTopic).toHaveBeenCalledWith(
      KafkaTopics.CallStarted,
      expect.objectContaining({
        push_recipient_ids: ['user-2'],
      }),
    );
  });
});
