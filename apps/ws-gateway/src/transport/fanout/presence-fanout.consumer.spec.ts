import { PresenceFanoutConsumer } from './presence-fanout.consumer';
import { WsEvents, type PresenceUpdatedEvent } from '@libs/contracts';

describe('PresenceFanoutConsumer', () => {
  const gateway = {
    broadcastToAuthenticated: jest.fn(),
    broadcastToAll: jest.fn(),
  };

  let consumer: PresenceFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new PresenceFanoutConsumer(gateway as never);
  });

  it('should broadcast presence updates only to authenticated sockets', () => {
    const payload: PresenceUpdatedEvent = {
      version: 'v1',
      user_id: 'user-1',
      status: 'online',
      last_seen_at: Date.now(),
      expires_at: Date.now() + 60000,
      source: 'connect',
      socket_count: 1,
      trace_id: 'trace-1',
    };

    consumer.onPresenceUpdated(payload);

    expect(gateway.broadcastToAuthenticated).toHaveBeenCalledWith(
      WsEvents.PresenceUpdate,
      payload,
    );
    expect(gateway.broadcastToAll).not.toHaveBeenCalled();
  });
});
