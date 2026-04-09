import { Injectable } from '@nestjs/common';

export interface SentNotification {
  userId: string;
  title: string;
  body: string;
  sentAt: number;
}

/**
 * In-memory store for notifications sent by MockNotificationProvider.
 * Used in tests to assert what notifications were dispatched.
 */
@Injectable()
export class SentNotificationStore {
  private readonly notifications: SentNotification[] = [];

  push(notification: SentNotification): void {
    this.notifications.push(notification);
  }

  list(): SentNotification[] {
    return [...this.notifications];
  }

  clear(): void {
    this.notifications.length = 0;
  }
}
