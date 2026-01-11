import { Injectable } from '@nestjs/common';
import {
  NotificationProvider,
  type SendNotificationInput,
  type SendNotificationResult,
} from '../notification.provider';
import { SentNotificationStore } from './sent-notification.store';

@Injectable()
export class MockNotificationProvider implements NotificationProvider {
  constructor(private readonly store: SentNotificationStore) {}

  send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const sentAt = Date.now();
    this.store.push({
      userId: input.userId,
      title: input.title,
      body: input.body,
      sentAt,
    });
    return Promise.resolve({ ok: true });
  }
}
