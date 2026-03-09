/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
/**
 * @file notification.consumer.spec.ts
 *
 * Unit tests for NotificationConsumer — Kafka consumer that
 * listens for NotificationRequested events, delegates to
 * NotificationBatcher/NotificationService, then handles the flush.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationConsumer } from './notification.consumer';
import { NotificationService } from '../services/notification.service';
import { NotificationBatcher } from '../services/notification.batcher';
import { NotificationMetrics } from '../services/notification.metrics';
import type {
  NotificationRequestedEvent,
  NotificationBatchCommand,
} from '@libs/contracts';

describe('NotificationConsumer', () => {
  let consumer: NotificationConsumer;
  let notificationService: Record<string, jest.Mock>;
  let batcher: Record<string, jest.Mock>;
  let metrics: Record<string, jest.Mock>;
  let stopTimer: jest.Mock;

  beforeEach(async () => {
    stopTimer = jest.fn();

    notificationService = {
      processNotification: jest.fn().mockResolvedValue(undefined),
      processBatch: jest.fn().mockResolvedValue(undefined),
    };

    batcher = {
      addToBatch: jest.fn().mockResolvedValue(null),
    };

    metrics = {
      startProcessingTimer: jest.fn().mockReturnValue(stopTimer),
      recordFailed: jest.fn(),
      recordBatched: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationConsumer,
        { provide: NotificationService, useValue: notificationService },
        { provide: NotificationBatcher, useValue: batcher },
        { provide: NotificationMetrics, useValue: metrics },
      ],
    }).compile();

    consumer = module.get<NotificationConsumer>(NotificationConsumer);
  });

  const basePayload: NotificationRequestedEvent = {
    user_id: 'user-123',
    title: 'New Message',
    body: 'Hello there',
    channel: 'push',
    trace_id: 'trace-abc',
    requested_at: Date.now(),
  };

  // ─── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should set batcher.onBatchReady callback', () => {
      consumer.onModuleInit();
      expect((batcher as any).onBatchReady).toBeDefined();
      expect(typeof (batcher as any).onBatchReady).toBe('function');
    });
  });

  // ─── onNotificationRequested ───────────────────────────────────────────────

  describe('onNotificationRequested', () => {
    it('should call batcher.addToBatch with the payload', async () => {
      await consumer.onNotificationRequested(basePayload);

      expect(batcher.addToBatch).toHaveBeenCalledWith(basePayload);
    });

    it('should start and stop the processing timer', async () => {
      await consumer.onNotificationRequested(basePayload);

      expect(metrics.startProcessingTimer).toHaveBeenCalled();
      expect(stopTimer).toHaveBeenCalled();
    });

    it('should call processBatch when batcher returns multiple flushed notifications', async () => {
      const flushed = [basePayload, { ...basePayload, user_id: 'user-456' }];
      batcher.addToBatch.mockResolvedValue(flushed);

      await consumer.onNotificationRequested(basePayload);

      expect(notificationService.processBatch).toHaveBeenCalledWith(flushed);
    });

    it('should call processNotification when batcher returns single flushed notification', async () => {
      const flushed = [basePayload];
      batcher.addToBatch.mockResolvedValue(flushed);

      await consumer.onNotificationRequested(basePayload);

      expect(notificationService.processNotification).toHaveBeenCalledWith(
        basePayload,
      );
    });

    it('should not call processBatch when batcher returns null (still batching)', async () => {
      batcher.addToBatch.mockResolvedValue(null);

      await consumer.onNotificationRequested(basePayload);

      expect(notificationService.processBatch).not.toHaveBeenCalled();
      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('should not call processBatch when batcher returns empty array', async () => {
      batcher.addToBatch.mockResolvedValue([]);

      await consumer.onNotificationRequested(basePayload);

      expect(notificationService.processBatch).not.toHaveBeenCalled();
    });

    it('should handle batcher errors gracefully (not throw)', async () => {
      batcher.addToBatch.mockRejectedValue(new Error('Redis down'));

      await expect(
        consumer.onNotificationRequested(basePayload),
      ).resolves.not.toThrow();
    });

    it('should record failure metric when error occurs', async () => {
      batcher.addToBatch.mockRejectedValue(new Error('Redis down'));

      await consumer.onNotificationRequested(basePayload);

      expect(metrics.recordFailed).toHaveBeenCalledWith(1);
    });

    it('should still stop timer even when error occurs', async () => {
      batcher.addToBatch.mockRejectedValue(new Error('Redis down'));

      await consumer.onNotificationRequested(basePayload);

      expect(stopTimer).toHaveBeenCalled();
    });
  });

  // ─── onNotificationBatch ──────────────────────────────────────────────────

  describe('onNotificationBatch', () => {
    const batchPayload: NotificationBatchCommand = {
      batch_id: 'batch-123',
      notifications: [basePayload],
      requested_at: Date.now(),
      trace_id: 'trace-batch',
    };

    it('should call notificationService.processBatch with batch notifications', async () => {
      await consumer.onNotificationBatch(batchPayload);

      expect(notificationService.processBatch).toHaveBeenCalledWith(
        batchPayload.notifications,
      );
    });

    it('should handle processBatch errors gracefully (not throw)', async () => {
      notificationService.processBatch.mockRejectedValue(
        new Error('Service down'),
      );

      await expect(
        consumer.onNotificationBatch(batchPayload),
      ).resolves.not.toThrow();
    });
  });
});
