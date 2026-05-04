import { KafkaTopics } from '@libs/contracts';
import { CallConsumer } from '../consumers/call.consumer';

describe('CallConsumer', () => {
  const callStateStore = {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
  };

  const callStateLock = {
    withLock: jest.fn((_scope: string, fn: () => Promise<unknown>) => fn()),
  };

  const callEventsPublisher = {
    publishStateUpdate: jest.fn(),
    publishNotMemberUpdate: jest.fn(),
    publishCallNotFoundUpdate: jest.fn(),
  };

  const kafkaClient = {
    emit: jest.fn(),
  };

  const callMembershipAccessService = {
    ensureMember: jest.fn(),
  };

  const callTimeoutService = {
    scheduleTimeout: jest.fn(),
    cancelTimeout: jest.fn(),
  };

  const callHistoryService = {
    createSession: jest.fn(),
    closeSession: jest.fn(),
  };

  const outbox = {
    publishToTopic: jest.fn().mockResolvedValue('queued'),
  };

  const systemMessageEmitter = {
    publish: jest.fn(),
  };

  let consumer: CallConsumer;

  const makeDirectState = (overrides = {}) => ({
    call_id: 'call-1',
    conversation_id: 'conv-1',
    conversation_type: 'direct' as const,
    call_type: 'audio' as const,
    status: 'ongoing' as const,
    initiator_id: 'user-1',
    participants: { 'user-1': 'accepted', 'user-2': 'accepted' },
    started_at: 1700000000000,
    ...overrides,
  });

  const makeGroupState = (overrides = {}) => ({
    call_id: 'call-1',
    conversation_id: 'conv-1',
    conversation_type: 'group' as const,
    call_type: 'audio' as const,
    status: 'ongoing' as const,
    initiator_id: 'user-1',
    participants: {
      'user-1': 'accepted',
      'user-2': 'accepted',
      'user-3': 'accepted',
    },
    started_at: 1700000000000,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    callMembershipAccessService.ensureMember.mockResolvedValue(true);
    callStateStore.get.mockResolvedValue(null);
    callStateStore.set.mockResolvedValue(undefined);
    callStateStore.clear.mockResolvedValue(undefined);
    callTimeoutService.scheduleTimeout.mockResolvedValue(undefined);
    callTimeoutService.cancelTimeout.mockResolvedValue(undefined);
    callHistoryService.createSession.mockResolvedValue(undefined);
    callHistoryService.closeSession.mockResolvedValue(undefined);
    outbox.publishToTopic.mockResolvedValue('queued');
    consumer = new CallConsumer(
      kafkaClient as never,
      callMembershipAccessService as never,
      callStateStore as never,
      callStateLock as never,
      callEventsPublisher as never,
      callTimeoutService as never,
      callHistoryService as never,
      outbox as never,
      systemMessageEmitter as never,
    );
  });

  // ── onCallStart ──────────────────────────────────────────────────────

  it('starts a call, stores state with conversation_type, and emits started/state-updated events', async () => {
    await consumer.onCallStart({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      initiator_id: 'user-1',
      call_type: 'video',
      participant_ids: ['user-2'],
      started_at: 1700000000000,
      trace_id: 'trace-1',
    });

    expect(callStateStore.set).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        call_id: 'call-1',
        conversation_type: 'direct',
      }),
    );
    expect(outbox.publishToTopic).toHaveBeenCalledWith(
      KafkaTopics.CallStarted,
      expect.objectContaining({ call_id: 'call-1', conversation_id: 'conv-1' }),
    );
    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ call_id: 'call-1' }),
      expect.objectContaining({ traceId: 'trace-1' }),
    );
  });

  it('blocks call start when user is not a conversation member', async () => {
    callMembershipAccessService.ensureMember.mockResolvedValue(false);

    await consumer.onCallStart({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      initiator_id: 'user-1',
      call_type: 'audio',
      participant_ids: ['user-2'],
      started_at: 1700000000000,
      trace_id: 'trace-guard',
    });

    expect(callEventsPublisher.publishNotMemberUpdate).toHaveBeenCalledWith(
      'conv-1',
      'user-1',
      'trace-guard',
    );
    expect(kafkaClient.emit).not.toHaveBeenCalled();
    expect(callStateStore.set).not.toHaveBeenCalled();
  });

  // ── onCallSignal ─────────────────────────────────────────────────────

  it('emits call_not_found when signaling without active call', async () => {
    await consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      signal_type: 'offer',
      sent_at: 1700000000001,
      trace_id: 'trace-2',
    });

    expect(callEventsPublisher.publishCallNotFoundUpdate).toHaveBeenCalledWith(
      'conv-1',
      'user-1',
      null,
      'trace-2',
    );
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallSignalForwarded,
      expect.anything(),
    );
  });

  it('rejects signal when target participant is not accepted', async () => {
    callStateStore.get.mockResolvedValue(
      makeDirectState({
        participants: { 'user-1': 'accepted', 'user-2': 'rejected' },
      }),
    );

    await consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      target_user_id: 'user-2',
      signal_type: 'offer',
      sent_at: 1700000000001,
    });

    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      expect.anything(),
      expect.objectContaining({ reason: 'target_not_in_call' }),
    );
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallSignalForwarded,
      expect.anything(),
    );
  });

  it('forwards signal when target is accepted', async () => {
    callStateStore.get.mockResolvedValue(makeDirectState());

    await consumer.onCallSignal({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      target_user_id: 'user-2',
      signal_type: 'offer',
      sent_at: 1700000000001,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallSignalForwarded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({
          sender_id: 'user-1',
          target_user_id: 'user-2',
        }),
      }),
    );
  });

  // ── onCallStateRequest ────────────────────────────────────────────────

  it('returns state to requester on call state request', async () => {
    await consumer.onCallStateRequest({
      conversation_id: 'conv-1',
      user_id: 'user-2',
      requested_at: 1700000000003,
      trace_id: 'trace-3',
    });

    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      null,
      expect.objectContaining({
        requestedBy: 'user-2',
        reason: 'no_active_call',
      }),
    );
  });

  // ── onCallEnd — direct ────────────────────────────────────────────────

  it('direct: any participant calling end terminates call for all', async () => {
    callStateStore.get.mockResolvedValue(makeDirectState());

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      ended_at: 1700000000010,
      trace_id: 'trace-4',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({
          call_id: 'call-1',
          conversation_id: 'conv-1',
        }),
      }),
    );
    expect(callStateStore.clear).toHaveBeenCalledWith('conv-1');
    expect(callEventsPublisher.publishStateUpdate).toHaveBeenCalledWith(
      'conv-1',
      null,
      expect.objectContaining({ reason: 'ended' }),
    );
  });

  // ── onCallEnd — group ─────────────────────────────────────────────────

  it('group: initiator calling end terminates call for all', async () => {
    callStateStore.get.mockResolvedValue(makeGroupState());

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      ended_at: 1700000000010,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ call_id: 'call-1' }),
      }),
    );
    expect(callStateStore.clear).toHaveBeenCalledWith('conv-1');
  });

  it('group: non-initiator calling end is treated as leave (call continues)', async () => {
    callStateStore.get.mockResolvedValue(makeGroupState());

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      ended_at: 1700000000010,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallLeft,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ user_id: 'user-2' }),
      }),
    );
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.anything(),
    );
    expect(callStateStore.clear).not.toHaveBeenCalled();
    expect(callStateStore.set).toHaveBeenLastCalledWith(
      'conv-1',
      expect.objectContaining({
        participants: {
          'user-1': 'accepted',
          'user-2': 'left',
          'user-3': 'accepted',
        },
      }),
    );
  });

  // ── onCallLeave ───────────────────────────────────────────────────────

  it('group leave: updates participant to left and emits CallLeft', async () => {
    callStateStore.get.mockResolvedValue(makeGroupState());

    await consumer.onCallLeave({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-3',
      left_at: 1700000000020,
      trace_id: 'trace-leave',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallLeft,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({
          user_id: 'user-3',
          call_id: 'call-1',
        }),
      }),
    );
    expect(callStateStore.clear).not.toHaveBeenCalled();
    expect(callStateStore.set).toHaveBeenLastCalledWith(
      'conv-1',
      expect.objectContaining({
        participants: {
          'user-1': 'accepted',
          'user-2': 'accepted',
          'user-3': 'left',
        },
      }),
    );
  });

  it('group leave: auto-ends call when last active participant leaves', async () => {
    callStateStore.get.mockResolvedValue(
      makeGroupState({
        participants: {
          'user-1': 'left',
          'user-2': 'left',
          'user-3': 'accepted',
        },
      }),
    );

    await consumer.onCallLeave({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-3',
      left_at: 1700000000020,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ reason: 'all_left' }),
      }),
    );
    expect(callStateStore.clear).toHaveBeenCalledWith('conv-1');
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallLeft,
      expect.anything(),
    );
  });

  // ── onCallReject — direct auto-end ───────────────────────────────────

  it('direct: auto-ends call when callee rejects', async () => {
    callStateStore.get.mockResolvedValue(
      makeDirectState({
        status: 'ringing',
        participants: { 'user-1': 'accepted', 'user-2': 'invited' },
      }),
    );

    await consumer.onCallReject({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      rejected_at: 1700000000005,
      trace_id: 'trace-reject',
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallRejected,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ user_id: 'user-2' }),
      }),
    );
    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ reason: 'rejected' }),
      }),
    );
    expect(callStateStore.clear).toHaveBeenCalledWith('conv-1');
  });

  it('group: reject does not end call (member can still join later)', async () => {
    callStateStore.get.mockResolvedValue(
      makeGroupState({
        status: 'ringing',
        participants: {
          'user-1': 'accepted',
          'user-2': 'invited',
          'user-3': 'invited',
        },
      }),
    );

    await consumer.onCallReject({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      rejected_at: 1700000000005,
    });

    expect(kafkaClient.emit).toHaveBeenCalledWith(
      KafkaTopics.CallRejected,
      expect.objectContaining({
        key: 'conv-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: expect.objectContaining({ user_id: 'user-2' }),
      }),
    );
    expect(kafkaClient.emit).not.toHaveBeenCalledWith(
      KafkaTopics.CallEnded,
      expect.anything(),
    );
    expect(callStateStore.clear).not.toHaveBeenCalled();
    expect(callStateStore.set).toHaveBeenLastCalledWith(
      'conv-1',
      expect.objectContaining({
        participants: {
          'user-1': 'accepted',
          'user-2': 'rejected',
          'user-3': 'invited',
        },
      }),
    );
  });

  it('group: member can accept after rejecting (re-join)', async () => {
    callStateStore.get.mockResolvedValue(
      makeGroupState({
        participants: {
          'user-1': 'accepted',
          'user-2': 'rejected',
          'user-3': 'accepted',
        },
      }),
    );

    await consumer.onCallAccept({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      accepted_at: 1700000000030,
    });

    expect(callStateStore.set).toHaveBeenLastCalledWith(
      'conv-1',
      expect.objectContaining({
        participants: {
          'user-1': 'accepted',
          'user-2': 'accepted',
          'user-3': 'accepted',
        },
      }),
    );
  });

  // ── CallSystemMessageEmitter is invoked on every terminateCall path ──

  it('emits an answered termination context when an ongoing direct call ends', async () => {
    callStateStore.get.mockResolvedValue(
      makeDirectState({ call_type: 'audio' }),
    );

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      ended_at: 1700000005000,
      trace_id: 'trace-end',
    });

    expect(systemMessageEmitter.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wasAnswered: true,
        endedAt: 1700000005000,
        traceId: 'trace-end',
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

  it('emits a missed termination context with reason=rejected when callee rejects a ringing direct call', async () => {
    callStateStore.get.mockResolvedValue(
      makeDirectState({
        status: 'ringing',
        participants: { 'user-1': 'accepted', 'user-2': 'invited' },
      }),
    );

    await consumer.onCallReject({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-2',
      rejected_at: 1700000000800,
      trace_id: 'trace-reject',
    });

    expect(systemMessageEmitter.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wasAnswered: false,
        reason: 'rejected',
        endedAt: 1700000000800,
        forceDurationMs: 0,
      }),
    );
  });

  it('emits a missed termination context with no explicit reason when initiator hangs up while ringing', async () => {
    callStateStore.get.mockResolvedValue(
      makeDirectState({
        status: 'ringing',
        participants: { 'user-1': 'accepted', 'user-2': 'invited' },
      }),
    );

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      ended_at: 1700000000800,
    });

    expect(systemMessageEmitter.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wasAnswered: false,
        reason: undefined,
      }),
    );
  });

  it('emits an answered termination context when last group participant leaves', async () => {
    callStateStore.get.mockResolvedValue(
      makeGroupState({
        participants: {
          'user-1': 'left',
          'user-2': 'left',
          'user-3': 'accepted',
        },
      }),
    );

    await consumer.onCallLeave({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-3',
      left_at: 1700000010000,
    });

    expect(systemMessageEmitter.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wasAnswered: true,
        reason: 'all_left',
        endedAt: 1700000010000,
      }),
    );
  });

  it('does not call the system-message emitter when terminate is short-circuited (no active call)', async () => {
    callStateStore.get.mockResolvedValue(null);

    await consumer.onCallEnd({
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      ended_at: 1700000005000,
    });

    expect(systemMessageEmitter.publish).not.toHaveBeenCalled();
  });
});
