import { KafkaTopics, WsEvents } from '@libs/contracts';
import { CallHandler } from './call.handler';

describe('CallHandler', () => {
  const kafka = {
    emit: jest.fn(),
  };

  const membershipService = {
    canUserAccessConversation: jest.fn(),
  };

  const rateLimiter = {
    checkStart: jest.fn(),
    checkEvent: jest.fn(),
    checkSignal: jest.fn(),
    checkControl: jest.fn(),
    checkStateRequest: jest.fn(),
  };

  let handler: CallHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    rateLimiter.checkStart.mockResolvedValue(0);
    rateLimiter.checkEvent.mockResolvedValue(0);
    rateLimiter.checkSignal.mockResolvedValue(0);
    rateLimiter.checkControl.mockResolvedValue(0);
    rateLimiter.checkStateRequest.mockResolvedValue(0);
    handler = new CallHandler(
      kafka as never,
      membershipService as never,
      rateLimiter as never,
    );
  });

  it('publishes call start command when user is a member', async () => {
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      data: { userId: 'user-1' },
      emit,
    } as never;

    await handler.handleStart(socket, {
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      call_type: 'video',
      participant_ids: ['user-2'],
      started_at: 1700000000000,
    });

    expect(kafka.emit).toHaveBeenCalledWith(
      KafkaTopics.CallStart,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({
          call_id: 'call-1',
          initiator_id: 'user-1',
        }),
      }),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits ws:error and skips kafka publish when user is not a member', async () => {
    membershipService.canUserAccessConversation.mockResolvedValue(false);
    const emit = jest.fn();
    const socket = {
      id: 'socket-2',
      data: { userId: 'user-2' },
      emit,
    } as never;

    await handler.handleStateRequest(socket, {
      conversation_id: 'conv-1',
      requested_at: 1700000000001,
    });

    expect(emit).toHaveBeenCalledWith(
      WsEvents.WsError,
      expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'not_member',
      }),
    );
    expect(kafka.emit).not.toHaveBeenCalled();
  });
});
