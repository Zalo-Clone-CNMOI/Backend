import type { LoggerService } from '@nestjs/common';
import type { ClientKafka } from '@nestjs/microservices';
import {
  KafkaReliabilityDefaults,
  toKafkaDlqTopic,
  type KafkaDlqEvent,
  type KafkaRetryPolicy,
} from '@libs/contracts';
import {
  catchError,
  defer,
  lastValueFrom,
  retry,
  throwError,
  timeout,
  timer,
} from 'rxjs';

export interface KafkaPublishOptions {
  kafka: ClientKafka;
  logger: LoggerService;
  topic: string;
  payload: unknown;
  producer: string;
  /**
   * Optional Kafka partition key. When set, the message is emitted as
   * `{ key, value: payload }` so all messages sharing a key land on the
   * same partition (ordering guarantee). When omitted, the payload is
   * emitted directly (round-robin partitioning, current behavior).
   */
  key?: string;
  retryPolicy?: Partial<KafkaRetryPolicy>;
  emitDlqOnFailure?: boolean;
}

export async function publishKafkaWithRetry(
  options: KafkaPublishOptions,
): Promise<void> {
  const policy = {
    maxRetries:
      options.retryPolicy?.maxRetries ?? KafkaReliabilityDefaults.maxRetries,
    timeoutMs:
      options.retryPolicy?.timeoutMs ?? KafkaReliabilityDefaults.timeoutMs,
    backoffBaseMs:
      options.retryPolicy?.backoffBaseMs ??
      KafkaReliabilityDefaults.backoffBaseMs,
    backoffCapMs:
      options.retryPolicy?.backoffCapMs ??
      KafkaReliabilityDefaults.backoffCapMs,
  };

  const shouldEmitDlq = options.emitDlqOnFailure ?? true;

  let attemptsUsed = 0;
  let lastBrokerError: unknown;

  try {
    const message =
      options.key !== undefined
        ? { key: options.key, value: options.payload }
        : options.payload;
    const source$ = defer(() => {
      attemptsUsed += 1;
      return options.kafka.emit(options.topic, message);
    }).pipe(
      timeout(policy.timeoutMs),
      retry({
        count: policy.maxRetries,
        delay: (error, retryCount) => {
          lastBrokerError = error;
          const delayMs = Math.min(
            policy.backoffCapMs,
            policy.backoffBaseMs * Math.pow(2, Math.max(0, retryCount - 1)),
          );
          options.logger.warn(
            `[KafkaPublish:${options.producer}] retry=${retryCount} topic=${options.topic} delayMs=${delayMs} error=${error instanceof Error ? error.message : String(error)}`,
          );
          return timer(delayMs);
        },
      }),
      catchError((error: unknown) => {
        lastBrokerError = error;
        return throwError(
          () =>
            new Error(
              `[KafkaPublish:${options.producer}] topic=${options.topic} failed after retries: ${error instanceof Error ? error.message : String(error)}`,
            ),
        );
      }),
    );

    await lastValueFrom(source$);
  } catch (error) {
    if (shouldEmitDlq) {
      await emitToDlq(options, lastBrokerError ?? error, attemptsUsed);
    }
    throw error;
  }
}

async function emitToDlq(
  options: KafkaPublishOptions,
  error: unknown,
  retryAttempts: number,
): Promise<void> {
  const dlqTopic = toKafkaDlqTopic(options.topic);
  const event: KafkaDlqEvent = {
    original_topic: options.topic,
    payload: options.payload,
    error_message: error instanceof Error ? error.message : String(error),
    retry_attempts: retryAttempts,
    failed_at: Date.now(),
    producer: options.producer,
    trace_id: extractTraceId(options.payload),
  };

  try {
    await lastValueFrom(
      options.kafka
        .emit(dlqTopic, event)
        .pipe(timeout(KafkaReliabilityDefaults.timeoutMs)),
    );
    options.logger.warn(
      `[KafkaPublish:${options.producer}] routed message to DLQ topic=${dlqTopic}`,
    );
  } catch (dlqError) {
    options.logger.error(
      `[KafkaPublish:${options.producer}] failed to route message to DLQ topic=${dlqTopic} error=${dlqError instanceof Error ? dlqError.message : String(dlqError)}`,
    );
  }
}

function extractTraceId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const value = (payload as Record<string, unknown>).trace_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
