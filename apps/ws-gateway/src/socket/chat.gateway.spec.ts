import { ChatGateway } from './chat.gateway';
import { WsEvents } from '@libs/contracts';
import { WsException } from '@nestjs/websockets';

describe('ChatGateway', () => {
  type QrBindSocket = Parameters<ChatGateway['handleQrBindRequest']>[0];

  const kafka = {
    connect: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  };
  const jwtService = { verifyToken: jest.fn() };
  const redisService = {
    setQrSocketBinding: jest.fn().mockResolvedValue(undefined),
    incrBy: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
  };
  const chatHandler = {
    handleJoin: jest.fn(),
    handleSend: jest.fn(),
    handleEdit: jest.fn(),
    handleDelete: jest.fn(),
    handleReact: jest.fn(),
    handleUnreact: jest.fn(),
  };
  const callHandler = {
    handleStart: jest.fn(),
    handleSignal: jest.fn(),
    handleAccept: jest.fn(),
    handleReject: jest.fn(),
    handleEnd: jest.fn(),
    handleStateRequest: jest.fn(),
  };
  const presenceHandler = {
    handleConnect: jest.fn(),
    handleDisconnect: jest.fn(),
    handleHeartbeat: jest.fn(),
  };
  const aiHandler = {
    handleSmartReply: jest.fn(),
    handleSummary: jest.fn(),
    handleTranslate: jest.fn(),
    handleDocumentQuery: jest.fn(),
  };
  const typingHandler = {
    setServer: jest.fn(),
    clearTyping: jest.fn(),
    handleTyping: jest.fn(),
  };
  const streamTracker = {
    track: jest.fn(),
    complete: jest.fn(),
    getActiveStreams: jest.fn().mockReturnValue([]),
  };

  let gateway: ChatGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ChatGateway(
      kafka as never,
      jwtService as never,
      redisService as never,
      chatHandler as never,
      callHandler as never,
      presenceHandler as never,
      aiHandler as never,
      typingHandler as never,
      streamTracker as never,
    );
  });

  describe('handleConnection', () => {
    it('should join authenticated rooms and emit connect presence when token is valid', () => {
      jwtService.verifyToken.mockReturnValue({ userId: 'user-1' });
      const join = jest.fn();
      const socket = {
        id: 'socket-1',
        handshake: {
          headers: { authorization: 'Bearer valid-token' },
          auth: {},
        },
        data: {},
        join,
        on: jest.fn(),
      } as never;

      gateway.handleConnection(socket);

      expect(join).toHaveBeenCalledWith('auth:clients');
      expect(join).toHaveBeenCalledWith('user:user-1');
      expect(presenceHandler.handleConnect).toHaveBeenCalledWith(
        socket,
        'user-1',
      );
    });

    it('should not emit connect presence when token is invalid', () => {
      jwtService.verifyToken.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const join = jest.fn();
      const socket = {
        id: 'socket-2',
        handshake: {
          headers: { authorization: 'Bearer invalid-token' },
          auth: {},
        },
        data: {},
        join,
      } as never;

      gateway.handleConnection(socket);

      expect(join).not.toHaveBeenCalledWith('auth:clients');
      expect(presenceHandler.handleConnect).not.toHaveBeenCalled();
    });
  });

  // ── Phase 6 C12: abort Zai streams on last-recipient disconnect ────────────

  describe('disconnect → AiStreamAbort', () => {
    function makeSocket(socketId: string, rooms: string[]) {
      return { id: socketId, rooms: new Set(rooms) } as never;
    }

    /** Invoke the private disconnect-abort routine directly. */
    function abortFor(socket: never): Promise<void> {
      return (
        gateway as unknown as {
          abortStreamsForDepartingSocket: (s: never) => Promise<void>;
        }
      ).abortStreamsForDepartingSocket(socket);
    }

    function setServer(fetchResult?: { id: string }[]) {
      const fetchSockets = jest.fn().mockResolvedValue(fetchResult ?? []);
      (gateway as unknown as { server: unknown }).server = {
        in: jest.fn().mockReturnValue({ fetchSockets }),
      };
    }

    it('handleConnection wires a "disconnecting" listener', () => {
      jwtService.verifyToken.mockReturnValue({ userId: 'user-1' });
      const on = jest.fn();
      const socket = {
        id: 'socket-1',
        handshake: {
          headers: { authorization: 'Bearer valid-token' },
          auth: {},
        },
        data: {},
        join: jest.fn(),
        on,
      } as never;

      gateway.handleConnection(socket);

      expect(on).toHaveBeenCalledWith('disconnecting', expect.any(Function));
    });

    it('publishes AiStreamAbort when the last recipient of a conversation leaves', async () => {
      streamTracker.getActiveStreams.mockReturnValue(['stream-1']);
      // Only the departing socket remains in the room.
      setServer([{ id: 'socket-1' }]);

      await abortFor(makeSocket('socket-1', ['conv:conv-1', 'user:user-1']));

      const abortCall = (kafka.emit.mock.calls as [string, unknown][]).find(
        ([topic]) => topic === 'ai.stream.abort',
      );
      expect(abortCall).toBeDefined();
      const envelope = abortCall![1] as {
        key: string;
        value: Record<string, unknown>;
      };
      expect(envelope.key).toBe('stream-1');
      expect(envelope.value).toMatchObject({
        stream_id: 'stream-1',
        conversation_id: 'conv-1',
        reason: 'client_disconnect',
      });
      expect(streamTracker.complete).toHaveBeenCalledWith('stream-1');
    });

    it('does NOT abort when another recipient remains in the conversation', async () => {
      streamTracker.getActiveStreams.mockReturnValue(['stream-1']);
      setServer([{ id: 'socket-1' }, { id: 'socket-2' }]);

      await abortFor(makeSocket('socket-1', ['conv:conv-1']));

      expect(kafka.emit).not.toHaveBeenCalledWith(
        'ai.stream.abort',
        expect.anything(),
      );
    });

    it('does nothing when the conversation has no active streams', async () => {
      streamTracker.getActiveStreams.mockReturnValue([]);
      setServer([]);

      await abortFor(makeSocket('socket-1', ['conv:conv-1']));

      expect(kafka.emit).not.toHaveBeenCalledWith(
        'ai.stream.abort',
        expect.anything(),
      );
    });
  });

  // ── Phase 6 C12: client "Stop" → ai:stream:cancel → AiStreamAbort ──────────

  describe('handleAiStreamCancel', () => {
    function makeSocket(socketId: string, rooms: string[]) {
      return { id: socketId, rooms: new Set(rooms) } as never;
    }

    it('publishes AiStreamAbort (reason user_cancel) for active streams when socket is in the conv room', () => {
      streamTracker.getActiveStreams.mockReturnValue(['stream-1']);

      gateway.handleAiStreamCancel(makeSocket('socket-1', ['conv:conv-1']), {
        conversation_id: 'conv-1',
      });

      const abortCall = (kafka.emit.mock.calls as [string, unknown][]).find(
        ([topic]) => topic === 'ai.stream.abort',
      );
      expect(abortCall).toBeDefined();
      const envelope = abortCall![1] as {
        key: string;
        value: Record<string, unknown>;
      };
      expect(envelope.key).toBe('stream-1');
      expect(envelope.value).toMatchObject({
        stream_id: 'stream-1',
        conversation_id: 'conv-1',
        reason: 'user_cancel',
      });
      expect(streamTracker.complete).toHaveBeenCalledWith('stream-1');
    });

    it('does NOT abort when the socket has not joined the conversation room', () => {
      streamTracker.getActiveStreams.mockReturnValue(['stream-1']);

      gateway.handleAiStreamCancel(makeSocket('socket-1', ['conv:other']), {
        conversation_id: 'conv-1',
      });

      expect(streamTracker.getActiveStreams).not.toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalledWith(
        'ai.stream.abort',
        expect.anything(),
      );
    });

    it('does nothing when the conversation has no active streams', () => {
      streamTracker.getActiveStreams.mockReturnValue([]);

      gateway.handleAiStreamCancel(makeSocket('socket-1', ['conv:conv-1']), {
        conversation_id: 'conv-1',
      });

      expect(kafka.emit).not.toHaveBeenCalledWith(
        'ai.stream.abort',
        expect.anything(),
      );
    });
  });

  describe('handleQrBindRequest', () => {
    it('should issue one-time socket binding token and emit it to requesting socket', async () => {
      const emitMock = jest.fn();
      const socket = {
        id: 'socket-qr-123',
        emit: emitMock,
      } as unknown as QrBindSocket;

      await gateway.handleQrBindRequest(socket);

      const [bindingTokenArg, socketIdArg, ttlArg] = redisService
        .setQrSocketBinding.mock.calls[0] as [string, string, number];

      // Token must be a non-empty string with at least 16 characters of entropy
      expect(typeof bindingTokenArg).toBe('string');
      expect(bindingTokenArg.length).toBeGreaterThanOrEqual(16);
      expect(socketIdArg).toBe('socket-qr-123');
      expect(ttlArg).toBe(90);

      expect(emitMock).toHaveBeenCalledTimes(1);
      const [emittedEvent, emittedPayload] = emitMock.mock.calls[0] as [
        string,
        {
          socketId: string;
          socketBindingToken: string;
          expiresInSeconds: number;
        },
      ];
      expect(emittedEvent).toBe(WsEvents.QrBindIssued);
      expect(emittedPayload.socketId).toBe('socket-qr-123');
      expect(typeof emittedPayload.socketBindingToken).toBe('string');
      expect(emittedPayload.expiresInSeconds).toBe(90);
    });

    it('should throw rate-limit exception and skip token issuance when rate limit is exceeded', async () => {
      redisService.incrBy.mockResolvedValue(6); // over the 5 req/min limit
      const emitMock = jest.fn();
      const socket = {
        id: 'socket-rl-456',
        emit: emitMock,
      } as unknown as QrBindSocket;

      await expect(gateway.handleQrBindRequest(socket)).rejects.toBeInstanceOf(
        WsException,
      );

      expect(redisService.setQrSocketBinding).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();
    });

    it('should keep binding ownership isolated per requesting socket', async () => {
      redisService.incrBy.mockResolvedValue(1);

      const firstSocketEmit = jest.fn();
      const secondSocketEmit = jest.fn();
      const firstSocket = {
        id: 'socket-owner-1',
        emit: firstSocketEmit,
      } as unknown as QrBindSocket;
      const secondSocket = {
        id: 'socket-owner-2',
        emit: secondSocketEmit,
      } as unknown as QrBindSocket;

      await gateway.handleQrBindRequest(firstSocket);
      await gateway.handleQrBindRequest(secondSocket);

      expect(redisService.setQrSocketBinding).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        'socket-owner-1',
        90,
      );
      expect(redisService.setQrSocketBinding).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        'socket-owner-2',
        90,
      );

      const firstCalls = firstSocketEmit.mock.calls as Array<
        [string, { socketId: string; socketBindingToken: string }]
      >;
      const secondCalls = secondSocketEmit.mock.calls as Array<
        [string, { socketId: string; socketBindingToken: string }]
      >;

      const [, firstPayload] = firstCalls[0];
      const [, secondPayload] = secondCalls[0];

      expect(firstPayload.socketId).toBe('socket-owner-1');
      expect(secondPayload.socketId).toBe('socket-owner-2');
      expect(firstPayload.socketBindingToken).not.toBe(
        secondPayload.socketBindingToken,
      );
    });
  });
});
