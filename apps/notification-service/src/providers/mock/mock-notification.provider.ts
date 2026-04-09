import { Injectable } from '@nestjs/common';
import type {
  INotificationProvider,
  SendNotificationInput,
  SendNotificationResult,
} from '../notification.provider';
import { SentNotificationStore } from './sent-notification.store';

/**
 * Mock notification provider for local development and testing.
 * Stores sent notifications in SentNotificationStore instead of
 * dispatching to a real push service.
 */
@Injectable()
export class MockNotificationProvider implements INotificationProvider {
  constructor(private readonly store: SentNotificationStore) {}

  send(input: SendNotificationInput): Promise<SendNotificationResult> {
    this.store.push({
      userId: input.userId,
      title: input.title,
      body: input.body,
      sentAt: Date.now(),
    });
    return Promise.resolve({ ok: true, successCount: 1, failureCount: 0 });
  }
}
