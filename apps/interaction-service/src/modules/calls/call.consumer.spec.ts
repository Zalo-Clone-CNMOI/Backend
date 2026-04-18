import { KafkaTopics } from '@libs/contracts';
import { CallConsumer } from './call.consumer';

describe('CallConsumer', () => {
  const redis = {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
  };

  const kafkaClient = {
    emit: jest.fn(),
  };

  const membershipService = {
    canUserAccessConversation: jest.fn(),
  };

  let consumer: CallConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    redis.get.mockResolvedValue(null);
    redis.setEx.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    consumer = new CallConsumer(
      redis as never,
      kafkaClient as never,
      membershipService as never,
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

    expect(redis.setEx).toHaveBeenCalledWith(
      'call:state:conversation:conv-1',
      21600,
      expect.stringContaining('"call_id":"call-1"'),
    );
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStarted,
      expect.objectContaining({
        call_id: 'call-1',
        conversation_id: 'conv-1',
      }),
    );
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStateUpdated,
      expect.objectContaining({
        conversation_id: 'conv-1',
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

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStateUpdated,
      expect.objectContaining({
        conversation_id: 'conv-1',
        requested_by: 'user-1',
        reason: 'call_not_found',
      }),
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

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStateUpdated,
      expect.objectContaining({
        conversation_id: 'conv-1',
        requested_by: 'user-2',
        reason: 'no_active_call',
      }),
    );
  });

  it('ends active call and clears call state', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
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
      }),
    );

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
    expect(redis.del).toHaveBeenCalledWith('call:state:conversation:conv-1');
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStateUpdated,
      expect.objectContaining({
        conversation_id: 'conv-1',
        state: null,
      }),
    );
  });
});
