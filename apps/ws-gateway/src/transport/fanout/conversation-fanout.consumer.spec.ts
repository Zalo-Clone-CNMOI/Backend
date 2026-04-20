import { ConversationFanoutConsumer } from './conversation-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('ConversationFanoutConsumer', () => {
  const gateway = {
    emitToUser: jest.fn(),
  };

  let consumer: ConversationFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new ConversationFanoutConsumer(gateway as never);
  });

  it('should emit conversation pinned event to user room', () => {
    consumer.onConversationPinned({
      userId: 'user-1',
      conversationId: 'conv-1',
      pinnedAt: 1706162900000,
      trace_id: 'trace-conv-pin-1',
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      WsEvents.ConversationPinned,
      {
        conversationId: 'conv-1',
        pinnedAt: 1706162900000,
      },
    );
  });

  it('should emit conversation unpinned event to user room', () => {
    consumer.onConversationUnpinned({
      userId: 'user-1',
      conversationId: 'conv-1',
      unpinnedAt: 1706163000000,
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      WsEvents.ConversationUnpinned,
      {
        conversationId: 'conv-1',
        unpinnedAt: 1706163000000,
      },
    );
  });
});
