import { KafkaTopics } from '@libs/contracts';
import { CallConsumer } from './call.consumer';

describe('CallConsumer', () => {
  const callStateStore = {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
  };

  const callEventsPublisher = {
    publishStateUpdate: jest.fn(),
    publishNotMemberUpdate: jest.fn(),
    publishCallNotFoundUpdate: jest.fn(),
  };

  const kafkaClient = {
    emit: jest.fn(),
  };

  const callMembershipAccessService = {
    ensureMember: jest.fn(),
  };

  let consumer: CallConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    callMembershipAccessService.ensureMember.mockResolvedValue(true);
    callStateStore.get.mockResolvedValue(null);
    callStateStore.set.mockResolvedValue(undefined);
    callStateStore.clear.mockResolvedValue(undefined);
    consumer = new CallConsumer(
      kafkaClient as never,
      callMembershipAccessService as never,
      callStateStore as never,
      callEventsPublisher as never,
    );
  });

  it('starts a call, stores state, and emits started/state-updated events', async () => {
    await consumer.onCallStart({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      initiator_id: 'user-1',
      call_type: 'video',
      participant_ids: ['user-2'],
      started_at: 1700000000000,
      trace_id: 'trace-1',
    });

    expect(callStateStore.set).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        call_id: 'call-1',
      }),
    );
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStarted,
      expect.objectContaining({
        call_id: 'call-1',
        conversation_id: 'conv-1',
      }),
    );
    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        call_id: 'call-1',
      }),
      expect.objectContaining({
        traceId: 'trace-1',
      }),
    );
  });

  it('emits call_not_found state update when signaling without active call', async () => {
    await consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      signal_type: 'offer',
      sent_at: 1700000000001,
      trace_id: 'trace-2',
    });

    expect(callEventsPublisher.publishCallNotFoundUpdate).toHaveBeenCalledWith(
      'conv-1',
      'user-1',
      null,
      'trace-2',
    );
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallSignalForwarded,
      expect.anything(),
    );
  });

  it('returns state to requester on call state request', async () => {
    await consumer.onCallStateRequest({
      conversation_id: 'conv-1',
      user_id: 'user-2',
      requested_at: 1700000000003,
      trace_id: 'trace-3',
    });

    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      null,
      expect.objectContaining({
        requestedBy: 'user-2',
        reason: 'no_active_call',
      }),
    );
  });

  it('ends active call and clears call state', async () => {
    callStateStore.get.mockResolvedValue({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      call_type: 'audio',
      status: 'ongoing',
      initiator_id: 'user-1',
      participants: {
        'user-1': 'accepted',
        'user-2': 'accepted',
      },
      started_at: 1700000000000,
    });

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      ended_at: 1700000000010,
      trace_id: 'trace-4',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        call_id: 'call-1',
        conversation_id: 'conv-1',
      }),
    );
    expect(callStateStore.clear).toHaveBeenCalledWith('conv-1');
    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      null,
      expect.objectContaining({
        reason: 'ended',
      }),
    );
  });
});
