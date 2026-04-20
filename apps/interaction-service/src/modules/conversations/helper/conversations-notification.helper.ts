import { Logger } from '@nestjs/common';
import {
  NotificationOutboxPublisher,
  type NotificationOutboxPublishResult,
} from '@libs/kafka/publisher/notification-outbox.publisher';
import { type NotificationRequestedEvent } from '@libs/contracts';

export async function enqueueNotifications(
  notifications: NotificationRequestedEvent[],
  context: string,
  notificationPublisher: NotificationOutboxPublisher,
  logger: Logger,
): Promise<void> {
  if (notifications.length === 0) {
    return;
  }

  const batchSize = 50;

  for (let offset = 0; offset < notifications.length; offset += batchSize) {
    const batch = notifications.slice(offset, offset + batchSize);
    const results = await Promise.allSettled(
      batch.map((notification) => notificationPublisher.publish(notification)),
    );

    logNotificationPublishRejections(
      results,
      batch.map((notification) => notification.user_id),
      context,
      logger,
    );
  }
}

export function logNotificationPublishRejections(
  results: PromiseSettledResult<NotificationOutboxPublishResult>[],
  recipientIds: string[],
  context: string,
  logger: Logger,
): void {
  results.forEach((result, index) => {
    if (result.status === 'rejected' || result.value === 'failed') {
      logger.error(
        `[NotificationOutbox] failed to enqueue notification context=${context} recipient=${recipientIds[index] ?? 'unknown'}`,
        result.status === 'rejected' ? result.reason : 'publish_failed',
      );
    }
  });
}
