import { CallFanoutConsumer } from './call-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('CallFanoutConsumer', () => {
  const gateway = {
    broadcastToConversation: jest.fn(),
    emitToUser: jest.fn(),
  };

  let consumer: CallFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new CallFanoutConsumer(gateway as never);
  });

  it('broadcasts call started to conversation room', () => {
    consumer.onCallStarted({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      initiator_id: 'user-1',
      call_type: 'video',
      participant_ids: ['user-1', 'user-2'],
      started_at: 1700000000000,
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.CallStarted,
      expect.objectContaining({
        call_id: 'call-1',
        call_type: 'video',
        conversation_type: 'direct',
      }),
    );
  });

  it('routes call signal to target user when target_user_id exists', () => {
    consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      target_user_id: 'user-2',
      signal_type: 'offer',
      sdp: 'v=0',
      sent_at: 1700000000001,
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-2',
      WsEvents.CallSignalReceived,
      expect.objectContaining({
        signal_type: 'offer',
      }),
    );
    expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
  });

  it('broadcasts call signal when target_user_id is absent', () => {
    consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      signal_type: 'ice-candidate',
      candidate: 'candidate:123',
      sent_at: 1700000000002,
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.CallSignalReceived,
      expect.objectContaining({
        signal_type: 'ice-candidate',
      }),
    );
    expect(gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('emits state update to requesting user for call state requests', () => {
    consumer.onCallStateUpdated({
      conversation_id: 'conv-1',
      requested_by: 'user-2',
      updated_at: 1700000000003,
      state: null,
      reason: 'no_active_call',
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-2',
      WsEvents.CallStateUpdated,
      expect.objectContaining({
        reason: 'no_active_call',
      }),
    );
  });
});
