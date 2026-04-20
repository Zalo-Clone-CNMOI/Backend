import { of } from 'rxjs';
import type { DataSource, Repository } from 'typeorm';
import type { ClientKafka } from '@nestjs/microservices';
import type { RedisClientType } from 'redis';
import { NotificationOutboxPublisher } from './notification-outbox.publisher';
import {
  NotificationType,
  type NotificationRequestedEvent,
} from '@libs/contracts';
import { NotificationOutbox } from '@libs/database/entities';

describe('NotificationOutboxPublisher', () => {
  const basePayload: NotificationRequestedEvent = {
    channel: 'push',
    user_id: 'user-1',
    title: 'title',
    body: 'body',
    type: NotificationType.System,
    requested_at: Date.now(),
    trace_id: 'trace-1',
  };

  const createPublisher = (overrides?: {
    redis?: Partial<RedisClientType>;
    repository?: Partial<Repository<NotificationOutbox>>;
    kafka?: Partial<ClientKafka>;
  }): NotificationOutboxPublisher => {
    const kafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockReturnValue(of(undefined)),
      ...(overrides?.kafka ?? {}),
    } as unknown as ClientKafka;

    const redis = {
      zAdd: jest.fn().mockResolvedValue(1),
      ...(overrides?.redis ?? {}),
    } as unknown as RedisClientType;

    const repository = {
      create: jest.fn().mockImplementation((data: unknown) => data),
      save: jest.fn().mockResolvedValue(undefined),
      ...(overrides?.repository ?? {}),
    } as unknown as Repository<NotificationOutbox>;

    const dataSource = {
      createQueryRunner: jest.fn(),
    } as unknown as DataSource;

    return new NotificationOutboxPublisher(
      kafka,
      redis,
      { serviceName: 'interaction-service' } as never,
      dataSource,
      repository,
    );
  };

  it('returns queued when Redis enqueue fails but DB fallback persists', async () => {
    const publisher = createPublisher({
      redis: {
        zAdd: jest.fn().mockRejectedValue(new Error('redis down')),
      },
      repository: {
        save: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(publisher.publish(basePayload)).resolves.toBe('queued');
  });

  it('returns queued when Redis and DB fail but direct Kafka fallback succeeds', async () => {
    const kafkaEmit = jest.fn().mockReturnValue(of(undefined));
    const publisher = createPublisher({
      redis: {
        zAdd: jest.fn().mockRejectedValue(new Error('redis down')),
      },
      repository: {
        save: jest.fn().mockRejectedValue(new Error('db down')),
      },
      kafka: {
        emit: kafkaEmit,
      },
    });

    await expect(publisher.publish(basePayload)).resolves.toBe('queued');
    expect(kafkaEmit).toHaveBeenCalled();
  });

  it('reclaims expired processing items using atomic move script until empty', async () => {
    const redisEval = jest
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    const publisher = createPublisher({
      redis: {
        eval: redisEval,
      },
    });

    const reclaimRunner = publisher as unknown as {
      reclaimExpiredProcessingItems: (now: number) => Promise<void>;
    };

    const now = 1_735_000_000_000;
    await reclaimRunner.reclaimExpiredProcessingItems(now);

    expect(redisEval).toHaveBeenCalledTimes(2);
    expect(redisEval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ZRANGE'),
      {
        keys: [
          'outbox:interaction-service:notification:processing:zset',
          'outbox:interaction-service:notification:zset',
        ],
        arguments: [String(now)],
      },
    );
  });

  it('stops reclaim immediately when earliest processing item is not due', async () => {
    const redisEval = jest.fn().mockResolvedValueOnce(1);

    const publisher = createPublisher({
      redis: {
        eval: redisEval,
      },
    });

    const reclaimRunner = publisher as unknown as {
      reclaimExpiredProcessingItems: (now: number) => Promise<void>;
    };

    await reclaimRunner.reclaimExpiredProcessingItems(Date.now());

    expect(redisEval).toHaveBeenCalledTimes(1);
  });
});
