import { of, throwError } from 'rxjs';
import {
  publishKafkaWithRetry,
  type KafkaPublishOptions,
} from './publish-with-retry.util';

describe('publishKafkaWithRetry', () => {
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should publish successfully without DLQ when emit succeeds', async () => {
    const kafka = {
      emit: jest.fn().mockReturnValue(of(undefined)),
    };

    const options: KafkaPublishOptions = {
      kafka: kafka as never,
      logger,
      topic: 'chat.message.created',
      payload: { trace_id: 'trace-ok' },
      producer: 'TestPublisher',
      retryPolicy: {
        maxRetries: 1,
        backoffBaseMs: 1,
        backoffCapMs: 1,
        timeoutMs: 50,
      },
    };

    await expect(publishKafkaWithRetry(options)).resolves.toBeUndefined();
    expect(kafka.emit).toHaveBeenCalledTimes(1);
    expect(kafka.emit).toHaveBeenCalledWith(
      'chat.message.created',
      expect.objectContaining({ trace_id: 'trace-ok' }),
    );
  });

  it('emits payload directly (no key wrapper) when key is omitted', async () => {
    const kafka = { emit: jest.fn().mockReturnValue(of(undefined)) };
    const payload = { trace_id: 'no-key' };
    await publishKafkaWithRetry({
      kafka: kafka as never,
      logger,
      topic: 'ai.stream.chunk',
      payload,
      producer: 'TestPublisher',
      retryPolicy: { maxRetries: 1, backoffBaseMs: 1, backoffCapMs: 1, timeoutMs: 50 },
    });
    // No key → message is the raw payload, NOT { key, value }.
    expect(kafka.emit).toHaveBeenCalledWith('ai.stream.chunk', payload);
  });

  it('wraps payload as { key, value } when a partition key is provided (W6)', async () => {
    const kafka = { emit: jest.fn().mockReturnValue(of(undefined)) };
    const payload = { stream_id: 'stream-42', trace_id: 'keyed' };
    await publishKafkaWithRetry({
      kafka: kafka as never,
      logger,
      topic: 'ai.stream.chunk',
      payload,
      key: 'stream-42',
      producer: 'TestPublisher',
      retryPolicy: { maxRetries: 1, backoffBaseMs: 1, backoffCapMs: 1, timeoutMs: 50 },
    });
    expect(kafka.emit).toHaveBeenCalledWith('ai.stream.chunk', {
      key: 'stream-42',
      value: payload,
    });
  });

  it('should route failed publish to DLQ and rethrow', async () => {
    const kafka = {
      emit: jest.fn((topic: string) => {
        if (topic === 'chat.message.created.dlq') {
          return of(undefined);
        }
        return throwError(() => new Error('broker down'));
      }),
    };

    const options: KafkaPublishOptions = {
      kafka: kafka as never,
      logger,
      topic: 'chat.message.created',
      payload: { trace_id: 'trace-fail', message_id: 'msg-1' },
      producer: 'TestPublisher',
      retryPolicy: {
        maxRetries: 1,
        backoffBaseMs: 1,
        backoffCapMs: 1,
        timeoutMs: 50,
      },
    };

    await expect(publishKafkaWithRetry(options)).rejects.toThrow(
      'chat.message.created',
    );
    const mainTopicCalls = (kafka.emit.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'chat.message.created',
    );
    expect(mainTopicCalls).toHaveLength(2);

    expect(kafka.emit).toHaveBeenCalledWith(
      'chat.message.created.dlq',
      expect.objectContaining({
        original_topic: 'chat.message.created',
        producer: 'TestPublisher',
        trace_id: 'trace-fail',
        retry_attempts: 2,
        error_message: 'broker down',
      }),
    );
  });

  it('should skip DLQ emission when disabled', async () => {
    const kafka = {
      emit: jest.fn(() => throwError(() => new Error('still down'))),
    };

    const options: KafkaPublishOptions = {
      kafka: kafka as never,
      logger,
      topic: 'chat.message.created',
      payload: { trace_id: 'trace-no-dlq' },
      producer: 'TestPublisher',
      emitDlqOnFailure: false,
      retryPolicy: {
        maxRetries: 1,
        backoffBaseMs: 1,
        backoffCapMs: 1,
        timeoutMs: 50,
      },
    };

    await expect(publishKafkaWithRetry(options)).rejects.toThrow();

    // maxRetries: 1 → initial + 1 retry = 2 calls to the main topic; no DLQ calls
    const calls = kafka.emit.mock.calls as unknown[][];
    expect(calls.filter((c) => c[0] === 'chat.message.created')).toHaveLength(
      2,
    );
    expect(calls.some((call) => call[0] === 'chat.message.created.dlq')).toBe(
      false,
    );
  });
});
