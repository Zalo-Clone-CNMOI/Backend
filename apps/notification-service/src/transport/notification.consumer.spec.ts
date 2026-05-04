/**
 * @file notification.consumer.spec.ts
 *
 * Unit tests for NotificationConsumer — Kafka consumer that
 * listens for NotificationRequested events, delegates to
 * NotificationBatcher/NotificationService, then handles the flush.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationConsumer } from './notification.consumer';
import { NotificationService } from '../services/notification.service';
import { NotificationBatcher } from '../services/notification.batcher';
import { NotificationMetrics } from '../services/notification.metrics';
import { NotificationType } from '@libs/contracts';
import type {
  CallEndedEvent,
  CallStartedEvent,
  NotificationRequestedEvent,
  NotificationBatchCommand,
} from '@libs/contracts';

describe('NotificationConsumer', () => {
  type InternalLogger = {
    debug: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

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

    const internalLogger = (consumer as unknown as { logger: InternalLogger })
      .logger;
    jest.spyOn(internalLogger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(internalLogger, 'error').mockImplementation(() => undefined);
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
      expect(batcher.onBatchReady).toBeDefined();
      expect(typeof batcher.onBatchReady).toBe('function');
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

  // ─── onCallStarted ────────────────────────────────────────────────────────

  describe('onCallStarted', () => {
    const baseCallStarted: CallStartedEvent = {
      call_id: 'call-1',
      conversation_id: 'conv-1',
      conversation_type: 'direct',
      initiator_id: 'user-1',
      call_type: 'audio',
      participant_ids: ['user-1', 'user-2'],
      started_at: Date.now(),
      trace_id: 'trace-call-start',
      push_recipient_ids: ['user-2'],
    };

    it('sends a high-priority IncomingCall push to every push_recipient_id, bypassing the batcher', async () => {
      const payload: CallStartedEvent = {
        ...baseCallStarted,
        push_recipient_ids: ['user-2', 'user-3'],
      };

      await consumer.onCallStarted(payload);

      expect(notificationService.processNotification).toHaveBeenCalledTimes(2);
      expect(batcher.addToBatch).not.toHaveBeenCalled();

      const firstCall = notificationService.processNotification.mock
        .calls[0][0] as NotificationRequestedEvent;
      expect(firstCall).toMatchObject({
        user_id: 'user-2',
        type: NotificationType.IncomingCall,
        title: 'Cuộc gọi thoại đến',
        rich: expect.objectContaining({
          priority: 'high',
          collapse_key: 'call:call-1',
          bypass_quiet_hours: true,
        }),
        data: expect.objectContaining({
          call_id: 'call-1',
          conversation_id: 'conv-1',
          conversation_type: 'direct',
          call_type: 'audio',
          initiator_id: 'user-1',
          action: 'incoming_call',
        }),
      });
    });

    it('forwards group conversation_type so FE can render group call UI', async () => {
      await consumer.onCallStarted({
        ...baseCallStarted,
        conversation_type: 'group',
      });

      const sent = notificationService.processNotification.mock
        .calls[0][0] as NotificationRequestedEvent;
      expect(sent.data?.conversation_type).toBe('group');
    });

    it('uses the video label for video calls', async () => {
      await consumer.onCallStarted({ ...baseCallStarted, call_type: 'video' });

      const sent = notificationService.processNotification.mock
        .calls[0][0] as NotificationRequestedEvent;
      expect(sent.title).toBe('Cuộc gọi video đến');
    });

    it('skips entirely when push_recipient_ids is empty', async () => {
      await consumer.onCallStarted({
        ...baseCallStarted,
        push_recipient_ids: [],
      });

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('skips entirely when push_recipient_ids is missing', async () => {
      const { push_recipient_ids: _drop, ...withoutRecipients } =
        baseCallStarted;
      void _drop;

      await consumer.onCallStarted(withoutRecipients as CallStartedEvent);

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('does not throw when one recipient push fails', async () => {
      notificationService.processNotification.mockRejectedValueOnce(
        new Error('FCM 500'),
      );

      await expect(
        consumer.onCallStarted({
          ...baseCallStarted,
          push_recipient_ids: ['user-2', 'user-3'],
        }),
      ).resolves.not.toThrow();

      expect(notificationService.processNotification).toHaveBeenCalledTimes(2);
    });
  });

  // ─── onCallEnded (missed-call push) ───────────────────────────────────────

  describe('onCallEnded', () => {
    const baseCallEnded: CallEndedEvent = {
      call_id: 'call-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      reason: 'timeout',
      ended_at: Date.now(),
      conversation_type: 'direct',
      initiator_id: 'user-1',
      participant_ids: ['user-1', 'user-2'],
      trace_id: 'trace-call-end',
    };

    it('sends MissedCall push to non-initiator on direct timeout', async () => {
      await consumer.onCallEnded(baseCallEnded);

      expect(notificationService.processNotification).toHaveBeenCalledTimes(1);
      const sent = notificationService.processNotification.mock
        .calls[0][0] as NotificationRequestedEvent;
      expect(sent).toMatchObject({
        user_id: 'user-2',
        type: NotificationType.MissedCall,
        title: 'Cuộc gọi nhỡ',
        data: expect.objectContaining({
          call_id: 'call-1',
          action: 'missed_call',
          initiator_id: 'user-1',
        }),
      });
    });

    it('also pushes for direct rejected and missed reasons', async () => {
      await consumer.onCallEnded({ ...baseCallEnded, reason: 'rejected' });
      await consumer.onCallEnded({ ...baseCallEnded, reason: 'missed' });

      expect(notificationService.processNotification).toHaveBeenCalledTimes(2);
    });

    it('skips when conversation is a group call', async () => {
      await consumer.onCallEnded({
        ...baseCallEnded,
        conversation_type: 'group',
        participant_ids: ['user-1', 'user-2', 'user-3'],
      });

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('skips when reason is undefined (normal hang-up after answer)', async () => {
      const { reason: _reason, ...withoutReason } = baseCallEnded;
      void _reason;

      await consumer.onCallEnded(withoutReason as CallEndedEvent);

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('skips for non-missed reasons like all_left', async () => {
      await consumer.onCallEnded({ ...baseCallEnded, reason: 'all_left' });

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('skips when no callees remain (only initiator in participant_ids)', async () => {
      await consumer.onCallEnded({
        ...baseCallEnded,
        participant_ids: ['user-1'],
      });

      expect(notificationService.processNotification).not.toHaveBeenCalled();
    });

    it('does not throw when push delivery fails', async () => {
      notificationService.processNotification.mockRejectedValueOnce(
        new Error('FCM 500'),
      );

      await expect(consumer.onCallEnded(baseCallEnded)).resolves.not.toThrow();
    });
  });
});
