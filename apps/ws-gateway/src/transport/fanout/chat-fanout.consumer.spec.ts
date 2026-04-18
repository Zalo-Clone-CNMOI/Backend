import { ChatFanoutConsumer } from './chat-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('ChatFanoutConsumer', () => {
  const gateway = {
    broadcastToConversation: jest.fn(),
  };

  let consumer: ChatFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new ChatFanoutConsumer(gateway as never);
  });

  it('should broadcast message pinned payload to conversation room', () => {
    consumer.onMessagePinned({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1706162800000,
      pinned_by: 'user-1',
      pinned_at: 1706162900000,
      trace_id: 'trace-pin-1',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessagePinned,
      {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        created_at: 1706162800000,
        pinned_by: 'user-1',
        pinned_at: 1706162900000,
      },
    );
  });

  it('should broadcast message unpinned payload to conversation room', () => {
    consumer.onMessageUnpinned({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1706162800000,
      unpinned_by: 'user-2',
      unpinned_at: 1706163000000,
      trace_id: 'trace-unpin-1',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessageUnpinned,
      {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        created_at: 1706162800000,
        unpinned_by: 'user-2',
        unpinned_at: 1706163000000,
      },
    );
  });
});
