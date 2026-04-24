import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import {
  KafkaTopics,
  type ChatPollMessageCommand,
  type ConversationMemberAddedEvent,
  type ConversationPollCreatedEvent,
  type GroupInviteAcceptedEvent,
  type GroupInviteCancelledEvent,
  type GroupInviteExpiredEvent,
  type GroupInviteRejectedEvent,
  type GroupInviteSentEvent,
  type NotificationRequestedEvent,
} from '@libs/contracts';
import { NotificationOutbox } from '@libs/database/entities';
import { REDIS_CLIENT } from '@libs/redis';
import type { RedisClientType } from 'redis';
import { KAFKA_CLIENT } from '../kafka.tokens';
import {
  publishKafkaWithRetry,
  type KafkaPublishOptions,
} from '../publish-with-retry.util';

interface NotificationOutboxItem {
  id: string;
  topic: string;
  payload: unknown;
  retryCount: number;
  firstFailedAt: number;
  nextAttemptAt: number;
  lastError?: string;
}

type OutboxTopicPayloadMap = {
  [KafkaTopics.NotificationRequested]: NotificationRequestedEvent;
  [KafkaTopics.GroupInviteSent]: GroupInviteSentEvent;
  [KafkaTopics.GroupInviteExpired]: GroupInviteExpiredEvent;
  [KafkaTopics.GroupInviteAccepted]: GroupInviteAcceptedEvent;
  [KafkaTopics.GroupInviteRejected]: GroupInviteRejectedEvent;
  [KafkaTopics.GroupInviteCancelled]: GroupInviteCancelledEvent;
  [KafkaTopics.ConversationMemberAdded]: ConversationMemberAddedEvent;
  [KafkaTopics.ConversationPollCreated]: ConversationPollCreatedEvent;
  [KafkaTopics.ChatPollMessageCreated]: ChatPollMessageCommand;
};

type RedisClaimResult =
  | { status: 'empty' }
  | { status: 'not_due' }
  | { status: 'claimed'; raw: string };

export type NotificationOutboxPublishResult = 'queued' | 'failed';

@Injectable()
export class NotificationOutboxPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxPublisher.name);
  private readonly flushIntervalMs = 5000;
  private readonly flushBatchSize = 50;
  private readonly maxOutboxRetries = 8;
  private readonly maxRedisBackoffMs = 5 * 60_000;
  private readonly exhaustedRetryDelayMs = 60 * 60_000;
  private readonly flushLockTtlSeconds = 30;
  private readonly redisLockRefreshIntervalMs = 10_000;
  private readonly processingVisibilityMs = 60_000;
  private readonly producerKey: string;
  private readonly outboxKey: string;
  private readonly processingKey: string;
  private readonly flushLockKey: string;
  private readonly dbFlushLockId: number;

  private flushTimer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly dataSource: DataSource,
    @InjectRepository(NotificationOutbox)
    private readonly notificationOutboxRepository: Repository<NotificationOutbox>,
  ) {
    this.producerKey = config.serviceName ?? 'unknown-service';
    this.outboxKey = `outbox:${this.producerKey}:notification:zset`;
    this.processingKey = `outbox:${this.producerKey}:notification:processing:zset`;
    this.flushLockKey = `outbox:${this.producerKey}:notification:flush-lock`;
    this.dbFlushLockId = this.computeStableLockId(this.producerKey);
  }

  async onModuleInit() {
    try {
      await this.kafka.connect();
    } catch (error) {
      this.logger.warn(
        `[NotificationOutbox] Kafka unavailable on startup, continue in degraded mode: ${this.asErrorMessage(error)}`,
      );
    }

    this.flushTimer = setInterval(() => {
      void this.flushOutboxDueItems();
    }, this.flushIntervalMs);

    void this.flushOutboxDueItems();
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  async publish(
    payload: NotificationRequestedEvent,
  ): Promise<NotificationOutboxPublishResult> {
    return this.publishToTopic(KafkaTopics.NotificationRequested, payload);
  }

  async publishToTopic<TTopic extends keyof OutboxTopicPayloadMap>(
    topic: TTopic,
    payload: OutboxTopicPayloadMap[TTopic],
  ): Promise<NotificationOutboxPublishResult> {
    const now = Date.now();
    const enqueued = await this.enqueueRedisOutbox(topic, payload, 0, now, now);

    if (!enqueued) {
      const dbPersisted = await this.persistDatabaseOutbox(
        topic,
        payload,
        0,
        now,
        now + 1000,
        'redis_enqueue_failed',
      );

      if (!dbPersisted) {
        try {
          await this.publishWithRetry(topic, payload, true);
          return 'queued';
        } catch (error) {
          this.logger.error(
            `[NotificationOutbox] terminal fallback failed trace_id=${this.extractTraceId(payload)} error=${this.asErrorMessage(error)}`,
          );
          return 'failed';
        }
      }

      return 'queued';
    }

    void this.flushOutboxDueItems();
    return 'queued';
  }

  private async flushOutboxDueItems(): Promise<void> {
    if (this.flushing) {
      return;
    }

    this.flushing = true;

    const redisLockToken = await this.acquireRedisFlushLock();
    const redisLockHeartbeat = redisLockToken
      ? this.startRedisFlushLockHeartbeat(redisLockToken)
      : undefined;

    try {
      if (redisLockToken) {
        try {
          await this.flushRedisOutboxDueItems();
        } catch (error) {
          this.logger.error(
            `[NotificationOutbox] redis flush failure: ${this.asErrorMessage(error)}`,
          );
        }
      }

      try {
        await this.flushDatabaseOutboxDueItems();
      } catch (error) {
        this.logger.error(
          `[NotificationOutbox] database flush failure: ${this.asErrorMessage(error)}`,
        );
      }
    } finally {
      this.flushing = false;
      if (redisLockHeartbeat) {
        clearInterval(redisLockHeartbeat);
      }
      if (redisLockToken) {
        await this.releaseRedisFlushLock(redisLockToken);
      }
    }
  }

  private async acquireRedisFlushLock(): Promise<string | null> {
    const lockToken = randomUUID();

    try {
      const acquired = await this.redis.set(this.flushLockKey, lockToken, {
        NX: true,
        EX: this.flushLockTtlSeconds,
      });
      return acquired === 'OK' ? lockToken : null;
    } catch (error) {
      this.logger.error(
        `[NotificationOutbox] failed to acquire flush lock: ${this.asErrorMessage(error)}`,
      );
      return null;
    }
  }

  private startRedisFlushLockHeartbeat(lockToken: string): NodeJS.Timeout {
    return setInterval(() => {
      void this.extendRedisFlushLock(lockToken);
    }, this.redisLockRefreshIntervalMs);
  }

  private async extendRedisFlushLock(lockToken: string): Promise<void> {
    try {
      await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
        {
          keys: [this.flushLockKey],
          arguments: [lockToken, String(this.flushLockTtlSeconds)],
        },
      );
    } catch (error) {
      this.logger.error(
        `[NotificationOutbox] failed to extend flush lock: ${this.asErrorMessage(error)}`,
      );
    }
  }

  private async releaseRedisFlushLock(lockToken: string): Promise<void> {
    try {
      await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
        {
          keys: [this.flushLockKey],
          arguments: [lockToken],
        },
      );
    } catch (error) {
      this.logger.error(
        `[NotificationOutbox] failed to release flush lock: ${this.asErrorMessage(error)}`,
      );
    }
  }

  private async flushRedisOutboxDueItems(): Promise<void> {
    const now = Date.now();
    await this.reclaimExpiredProcessingItems(now);

    for (let index = 0; index < this.flushBatchSize; index += 1) {
      const claimResult = await this.claimDueRedisOutboxItem(now);
      if (claimResult.status === 'empty') {
        break;
      }

      if (claimResult.status === 'not_due') {
        break;
      }

      const raw = claimResult.raw;

      const parsed = this.parseOutboxItem(raw);
      if (!parsed) {
        await this.ackProcessingItem(raw);
        continue;
      }

      try {
        await this.publishWithRetry(parsed.topic, parsed.payload, false);
        await this.ackProcessingItem(raw);
      } catch (error) {
        const nextRetryCount = parsed.retryCount + 1;
        const errorMessage = this.asErrorMessage(error);

        if (nextRetryCount > this.maxOutboxRetries) {
          const persisted = await this.persistDatabaseOutbox(
            parsed.topic,
            parsed.payload,
            nextRetryCount,
            parsed.firstFailedAt,
            now + this.exhaustedRetryDelayMs,
            `redis_outbox_exhausted:${errorMessage}`,
          );

          if (persisted) {
            await this.ackProcessingItem(raw);
          } else {
            const requeued = await this.enqueueRedisOutbox(
              parsed.topic,
              parsed.payload,
              parsed.retryCount,
              parsed.firstFailedAt,
              parsed.nextAttemptAt,
              `db_persist_failed:${errorMessage}`,
            );

            if (requeued) {
              await this.ackProcessingItem(raw);
            }
          }

          continue;
        }

        const requeued = await this.enqueueRedisOutbox(
          parsed.topic,
          parsed.payload,
          nextRetryCount,
          parsed.firstFailedAt,
          undefined,
          errorMessage,
        );

        if (requeued) {
          await this.ackProcessingItem(raw);
          continue;
        }

        const persisted = await this.persistDatabaseOutbox(
          parsed.topic,
          parsed.payload,
          nextRetryCount,
          parsed.firstFailedAt,
          now + this.computeBackoffMs(nextRetryCount),
          `redis_requeue_failed:${errorMessage}`,
        );

        if (persisted) {
          await this.ackProcessingItem(raw);
        } else {
          const fallbackRequeued = await this.enqueueRedisOutbox(
            parsed.topic,
            parsed.payload,
            parsed.retryCount,
            parsed.firstFailedAt,
            parsed.nextAttemptAt,
            `db_persist_failed:${errorMessage}`,
          );

          if (fallbackRequeued) {
            await this.ackProcessingItem(raw);
          }
        }
      }
    }
  }

  private async reclaimExpiredProcessingItems(now: number): Promise<void> {
    for (let index = 0; index < this.flushBatchSize; index += 1) {
      const reclaimResult = (await this.redis.eval(
        `
          local item = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
          if #item == 0 then
            return 0
          end

          local value = item[1]
          local score = tonumber(item[2])
          local now = tonumber(ARGV[1])

          if score > now then
            return 1
          end

          redis.call('ZREM', KEYS[1], value)
          redis.call('ZADD', KEYS[2], now, value)
          return 2
        `,
        {
          keys: [this.processingKey, this.outboxKey],
          arguments: [String(now)],
        },
      )) as unknown;

      if (typeof reclaimResult !== 'number') {
        break;
      }

      if (reclaimResult === 0 || reclaimResult === 1) {
        break;
      }
    }
  }

  private async claimDueRedisOutboxItem(
    now: number,
  ): Promise<RedisClaimResult> {
    const processingUntil = now + this.processingVisibilityMs;
    const claimResult = (await this.redis.eval(
      `
        local item = redis.call('ZPOPMIN', KEYS[1], 1)
        if #item == 0 then
          return {0}
        end

        local value = item[1]
        local score = tonumber(item[2])
        local now = tonumber(ARGV[1])

        if score > now then
          redis.call('ZADD', KEYS[1], score, value)
          return {1}
        end

        redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), value)
        return {2, value}
      `,
      {
        keys: [this.outboxKey, this.processingKey],
        arguments: [String(now), String(processingUntil)],
      },
    )) as unknown;

    if (!Array.isArray(claimResult) || claimResult.length === 0) {
      return { status: 'empty' };
    }

    const code = Number(claimResult[0]);
    if (code === 0) {
      return { status: 'empty' };
    }

    if (code === 1) {
      return { status: 'not_due' };
    }

    const rawValue: unknown = claimResult[1];
    if (typeof rawValue === 'string') {
      return { status: 'claimed', raw: rawValue };
    }

    return { status: 'empty' };
  }

  private async ackProcessingItem(raw: string): Promise<void> {
    await this.redis.zRem(this.processingKey, raw);
  }

  private async flushDatabaseOutboxDueItems(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();

    const now = new Date();
    try {
      const lockResult = (await queryRunner.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [this.dbFlushLockId],
      )) as Array<{ acquired?: boolean | 't' | 1 }>;
      const acquiredValue = lockResult?.[0]?.acquired;
      const dbLockAcquired =
        acquiredValue === true || acquiredValue === 't' || acquiredValue === 1;

      if (!dbLockAcquired) {
        return;
      }

      const outboxRepository =
        queryRunner.manager.getRepository(NotificationOutbox);
      const dueRows = await outboxRepository
        .createQueryBuilder('outbox')
        .where('outbox.producer = :producer', { producer: this.producerKey })
        .andWhere('outbox.nextAttemptAt <= :now', { now })
        .orderBy('outbox.nextAttemptAt', 'ASC')
        .limit(this.flushBatchSize)
        .getMany();

      for (const row of dueRows) {
        const topic = row.topic;
        const payload = row.payload;

        try {
          await this.publishWithRetry(topic, payload, false);
          await outboxRepository.delete(row.id);
        } catch (error) {
          const nextRetryCount = row.retryCount + 1;
          const errorMessage = this.asErrorMessage(error);

          if (nextRetryCount > this.maxOutboxRetries) {
            await outboxRepository.update(row.id, {
              retryCount: nextRetryCount,
              nextAttemptAt: new Date(Date.now() + this.exhaustedRetryDelayMs),
              lastError: `db_outbox_exhausted:${errorMessage}`,
            });
            continue;
          }

          await outboxRepository.update(row.id, {
            retryCount: nextRetryCount,
            nextAttemptAt: new Date(
              Date.now() + this.computeBackoffMs(nextRetryCount),
            ),
            lastError: errorMessage,
          });
        }
      }
    } finally {
      await queryRunner
        .query('SELECT pg_advisory_unlock($1)', [this.dbFlushLockId])
        .catch((error: unknown) => {
          this.logger.error(
            `[NotificationOutbox] failed to release database flush lock: ${this.asErrorMessage(error)}`,
          );
        });
      await queryRunner.release();
    }
  }

  private async enqueueRedisOutbox(
    topic: string,
    payload: unknown,
    retryCount: number,
    firstFailedAt: number,
    nextAttemptAt?: number,
    lastError?: string,
  ): Promise<boolean> {
    const now = Date.now();
    const scheduledAt =
      nextAttemptAt ?? now + this.computeBackoffMs(retryCount);

    const outboxItem: NotificationOutboxItem = {
      id: `${topic}:${this.extractTraceId(payload) ?? 'unknown'}:${now}:${retryCount}`,
      topic,
      payload,
      retryCount,
      firstFailedAt,
      nextAttemptAt: scheduledAt,
      lastError,
    };

    try {
      await this.redis.zAdd(this.outboxKey, [
        {
          score: outboxItem.nextAttemptAt,
          value: JSON.stringify(outboxItem),
        },
      ]);
      return true;
    } catch (error) {
      this.logger.error(
        `[NotificationOutbox] redis enqueue failed trace_id=${this.extractTraceId(payload)} error=${this.asErrorMessage(error)}`,
      );
      return false;
    }
  }

  private async persistDatabaseOutbox(
    topic: string,
    payload: unknown,
    retryCount: number,
    firstFailedAt: number,
    nextAttemptAt: number,
    lastError: string,
  ): Promise<boolean> {
    try {
      await this.notificationOutboxRepository.save(
        this.notificationOutboxRepository.create({
          producer: this.producerKey,
          topic,
          payload,
          retryCount,
          firstFailedAt: new Date(firstFailedAt),
          nextAttemptAt: new Date(nextAttemptAt),
          lastError,
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[NotificationOutbox] db fallback persist failed trace_id=${this.extractTraceId(payload)} error=${this.asErrorMessage(error)}`,
      );
      return false;
    }
  }

  private computeBackoffMs(retryCount: number): number {
    return Math.min(this.maxRedisBackoffMs, 1000 * Math.pow(2, retryCount));
  }

  private computeStableLockId(input: string): number {
    let hash = 0;

    for (let i = 0; i < input.length; i += 1) {
      hash = (hash * 31 + input.charCodeAt(i)) | 0;
    }

    const normalized = Math.abs(hash);
    return normalized === 0 ? 1 : normalized;
  }

  private async publishWithRetry(
    topic: string,
    payload: unknown,
    emitDlqOnFailure: boolean,
  ): Promise<void> {
    const options: KafkaPublishOptions = {
      kafka: this.kafka,
      logger: this.logger,
      topic,
      payload,
      producer: this.producerKey,
      emitDlqOnFailure,
    };

    await publishKafkaWithRetry(options);
  }

  private extractTraceId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const traceId = (payload as Record<string, unknown>).trace_id;
    if (typeof traceId !== 'string' || traceId.length === 0) {
      return undefined;
    }

    return traceId;
  }

  private parseOutboxItem(raw: string): NotificationOutboxItem | null {
    try {
      const parsed = JSON.parse(raw) as Partial<NotificationOutboxItem>;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const topic =
        typeof parsed.topic === 'string' && parsed.topic.length > 0
          ? parsed.topic
          : KafkaTopics.NotificationRequested;

      return {
        id: String(parsed.id ?? randomUUID()),
        topic,
        payload: parsed.payload,
        retryCount:
          typeof parsed.retryCount === 'number' ? parsed.retryCount : 0,
        firstFailedAt:
          typeof parsed.firstFailedAt === 'number'
            ? parsed.firstFailedAt
            : Date.now(),
        nextAttemptAt:
          typeof parsed.nextAttemptAt === 'number'
            ? parsed.nextAttemptAt
            : Date.now(),
        lastError:
          typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      };
    } catch {
      this.logger.warn('[NotificationOutbox] dropped malformed outbox item');
      return null;
    }
  }

  private asErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
