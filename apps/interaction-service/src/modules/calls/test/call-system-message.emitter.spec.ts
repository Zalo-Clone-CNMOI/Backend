import { of, throwError } from 'rxjs';
import { KafkaTopics, SystemEventType } from '@libs/contracts';
import { CallSystemMessageEmitter } from '../services/call-system-message.emitter';

describe('CallSystemMessageEmitter', () => {
  const kafkaClient = {
    emit: jest.fn(),
  };

  let emitter: CallSystemMessageEmitter;

  const baseState = (overrides: Record<string, unknown> = {}) => ({
    call_id: 'call-1',
    conversation_id: 'conv-1',
    conversation_type: 'direct' as const,
    call_type: 'audio' as const,
    status: 'ended' as const, // doesn't matter for emitter; consumer captures wasAnswered upstream
    initiator_id: 'user-1',
    participants: { 'user-1': 'left', 'user-2': 'left' } as const,
    started_at: 1700000000000,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    kafkaClient.emit.mockReturnValue(of(undefined));
    emitter = new CallSystemMessageEmitter(kafkaClient as never);
  });

  it('publishes CALL_ENDED with computed duration and audio body when answered', () => {
    emitter.publish({
      state: baseState({ call_type: 'audio' }) as never,
      endedAt: 1700000005000, // 5s
      wasAnswered: true,
      traceId: 'trace-end',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        message_id: 'call-ended:call-1',
        conversation_id: 'conv-1',
        message_type: 'system',
        system_event_type: SystemEventType.CALL_ENDED,
        body: 'Cuộc gọi thoại - 0 phút 5 giây',
        trace_id: 'trace-end',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          call_id: 'call-1',
          call_type: 'audio',
          initiator_id: 'user-1',
          duration_ms: 5000,
          started_at: 1700000000000,
          ended_at: 1700000005000,
        }),
      }),
    );
  });

  it('formats video call body and minute-level durations', () => {
    emitter.publish({
      state: baseState({ call_type: 'video' }) as never,
      endedAt: 1700000185000, // 3m 5s
      wasAnswered: true,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        body: 'Cuộc gọi video - 3 phút 5 giây',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({ duration_ms: 185000 }),
      }),
    );
  });

  it('clamps negative duration (clock skew) to 0', () => {
    emitter.publish({
      state: baseState({ call_type: 'audio' }) as never,
      endedAt: 1699999999000, // before started_at
      wasAnswered: true,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        body: 'Cuộc gọi thoại - 0 phút 0 giây',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({ duration_ms: 0 }),
      }),
    );
  });

  it('publishes CALL_MISSED with reason=timeout and deterministic id', () => {
    emitter.publish({
      state: baseState() as never,
      endedAt: 1700000045000,
      wasAnswered: false,
      reason: 'timeout',
      traceId: 'trace-timeout',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        message_id: 'call-missed:call-1',
        system_event_type: SystemEventType.CALL_MISSED,
        body: 'Cuộc gọi thoại nhỡ',
        trace_id: 'trace-timeout',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          reason: 'timeout',
          call_id: 'call-1',
        }),
      }),
    );
  });

  it('preserves rejected reason for callee rejection path', () => {
    emitter.publish({
      state: baseState() as never,
      endedAt: 1700000000800,
      wasAnswered: false,
      reason: 'rejected',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({ reason: 'rejected' }),
      }),
    );
  });

  it('normalizes unknown reasons to missed', () => {
    emitter.publish({
      state: baseState() as never,
      endedAt: 1700000000800,
      wasAnswered: false,
      reason: 'all_left',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatSystemMessageCreated,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({ reason: 'missed' }),
      }),
    );
  });

  it('uses deterministic message_id so chat-service idempotency dedupes redelivery', () => {
    emitter.publish({
      state: baseState() as never,
      endedAt: 1700000005000,
      wasAnswered: true,
    });
    emitter.publish({
      state: baseState() as never,
      endedAt: 1700000005000,
      wasAnswered: true,
    });

    const ids = kafkaClient.emit.mock.calls.map(
      ([, payload]: [string, { message_id: string }]) => payload.message_id,
    );
    expect(ids).toEqual(['call-ended:call-1', 'call-ended:call-1']);
  });

  it('logs but does not throw when async kafka publish fails', () => {
    kafkaClient.emit.mockReturnValue(
      throwError(() => new Error('broker unreachable')),
    );

    expect(() =>
      emitter.publish({
        state: baseState() as never,
        endedAt: 1700000005000,
        wasAnswered: true,
      }),
    ).not.toThrow();
  });
});
