import { ChatGateway } from './chat.gateway';
import { WsEvents } from '@libs/contracts';

describe('ChatGateway', () => {
  type QrBindSocket = Parameters<ChatGateway['handleQrBindRequest']>[0];

  const kafka = { connect: jest.fn().mockResolvedValue(undefined) };
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

  let gateway: ChatGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ChatGateway(
      kafka as never,
      jwtService as never,
      redisService as never,
      chatHandler as never,
      presenceHandler as never,
      aiHandler as never,
      typingHandler as never,
    );
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

      expect(typeof bindingTokenArg).toBe('string');
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

    it('should emit error and skip token issuance when rate limit is exceeded', async () => {
      redisService.incrBy.mockResolvedValue(6); // over the 5 req/min limit
      const emitMock = jest.fn();
      const socket = {
        id: 'socket-rl-456',
        emit: emitMock,
      } as unknown as QrBindSocket;

      await gateway.handleQrBindRequest(socket);

      expect(redisService.setQrSocketBinding).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      );
    });
  });
});
