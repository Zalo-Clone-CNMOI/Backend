import { of } from 'rxjs';
import { KafkaTopics } from '@libs/contracts';
import { CallTimeoutScheduler } from '../services/call-timeout.scheduler';

describe('CallTimeoutScheduler', () => {
  const timeoutService = {
    popDueTimeouts: jest.fn(),
  };
  const stateStore = {
    get: jest.fn(),
    clear: jest.fn(),
  };
  const stateLock = {
    withLock: jest.fn(async (_scope: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  };
  const kafkaClient = {
    emit: jest.fn().mockReturnValue(of(undefined)),
  };
  const callHistoryService = {
    closeSession: jest.fn().mockResolvedValue(undefined),
  };
  const systemMessageEmitter = {
    publish: jest.fn(),
  };

  const ringingState = (overrides: Record<string, unknown> = {}) => ({
    call_id: 'call-1',
    conversation_id: 'conv-1',
    conversation_type: 'direct' as const,
    call_type: 'audio' as const,
    status: 'ringing' as const,
    initiator_id: 'user-1',
    participants: { 'user-1': 'accepted', 'user-2': 'invited' } as const,
    started_at: 1700000000000,
    ...overrides,
  });

  let scheduler: CallTimeoutScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    stateStore.get.mockResolvedValue(ringingState());
    stateStore.clear.mockResolvedValue(undefined);
    timeoutService.popDueTimeouts.mockResolvedValue([
      { callId: 'call-1', conversationId: 'conv-1' },
    ]);
    scheduler = new CallTimeoutScheduler(
      timeoutService as never,
      stateStore as never,
      stateLock as never,
      kafkaClient as never,
      callHistoryService as never,
      systemMessageEmitter as never,
    );
  });

  it('publishes CallTimedOut and CallEnded events when timeout fires', async () => {
    await scheduler.checkTimeouts();

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallTimedOut,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({
          call_id: 'call-1',
          conversation_id: 'conv-1',
        }),
      }),
    );
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ reason: 'timeout' }),
      }),
    );
  });

  it('emits a missed termination context to the system-message emitter on timeout', async () => {
    await scheduler.checkTimeouts();

    expect(systemMessageEmitter.publish).toHaveBeenCalledTimes(1);
    expect(systemMessageEmitter.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wasAnswered: false,
        reason: 'timeout',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        state: expect.objectContaining({
          call_id: 'call-1',
          call_type: 'audio',
          initiator_id: 'user-1',
          started_at: 1700000000000,
        }),
      }),
    );
  });

  it('skips emission when there is no active ringing call', async () => {
    stateStore.get.mockResolvedValue(null);

    await scheduler.checkTimeouts();

    expect(systemMessageEmitter.publish).not.toHaveBeenCalled();
    expect(kafkaClient.emit).not.toHaveBeenCalled();
  });

  it('skips emission when stored call_id does not match the due timeout', async () => {
    stateStore.get.mockResolvedValue(ringingState({ call_id: 'call-other' }));

    await scheduler.checkTimeouts();

    expect(systemMessageEmitter.publish).not.toHaveBeenCalled();
  });

  it('skips emission when call has already moved past ringing', async () => {
    stateStore.get.mockResolvedValue(ringingState({ status: 'ongoing' }));

    await scheduler.checkTimeouts();

    expect(systemMessageEmitter.publish).not.toHaveBeenCalled();
  });
});
