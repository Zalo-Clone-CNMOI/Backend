import { AuthFanoutConsumer } from './auth-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('AuthFanoutConsumer', () => {
  const gateway = {
    emitToSocket: jest.fn(),
  };

  let consumer: AuthFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new AuthFanoutConsumer(gateway as never);
  });

  it('should emit QR confirmed payload only to the bound socket', () => {
    consumer.onQrConfirmed({
      sessionId: 'session-1',
      socketId: 'socket-owner-1',
      userId: 'user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
      user: {
        id: 'user-1',
        phone: '+84901234567',
        fullName: 'User One',
        email: null,
        avatarUrl: null,
      },
      trace_id: 'trace-qr-confirmed',
    });

    expect(gateway.emitToSocket).toHaveBeenCalledWith(
      'socket-owner-1',
      WsEvents.QrConfirmed,
      expect.objectContaining({
        sessionId: 'session-1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    );
  });

  it('should emit QR rejected payload only to the bound socket', () => {
    consumer.onQrRejected({
      sessionId: 'session-2',
      socketId: 'socket-owner-2',
      reason: 'User rejected QR login',
      trace_id: 'trace-qr-rejected',
    });

    expect(gateway.emitToSocket).toHaveBeenCalledWith(
      'socket-owner-2',
      WsEvents.QrRejected,
      expect.objectContaining({
        sessionId: 'session-2',
        reason: 'User rejected QR login',
      }),
    );
  });

  it('should not emit QR confirmed event to any socket other than the bound one', () => {
    consumer.onQrConfirmed({
      sessionId: 'session-3',
      socketId: 'socket-owner-3',
      userId: 'user-3',
      accessToken: 'tok',
      refreshToken: 'rtok',
      expiresIn: 900,
      user: {
        id: 'user-3',
        phone: '+84900000003',
        fullName: 'User Three',
        email: null,
        avatarUrl: null,
      },
      trace_id: 'trace-exclusion',
    });

    // emitToSocket must be called exactly once — no broadcast to other sockets
    expect(gateway.emitToSocket).toHaveBeenCalledTimes(1);
    const [[calledSocketId]] = gateway.emitToSocket.mock.calls as Array<
      [string, ...unknown[]]
    >;
    expect(calledSocketId).toBe('socket-owner-3');
  });

  it('should not emit QR rejected event to any socket other than the bound one', () => {
    consumer.onQrRejected({
      sessionId: 'session-4',
      socketId: 'socket-owner-4',
      reason: 'Rejected',
      trace_id: 'trace-exclusion-rejected',
    });

    expect(gateway.emitToSocket).toHaveBeenCalledTimes(1);
    const [[calledSocketId]] = gateway.emitToSocket.mock.calls as Array<
      [string, ...unknown[]]
    >;
    expect(calledSocketId).toBe('socket-owner-4');
  });
});
