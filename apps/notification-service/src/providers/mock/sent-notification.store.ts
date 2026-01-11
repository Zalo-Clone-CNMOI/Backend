import { Injectable } from '@nestjs/common';

export interface SentNotification {
  userId: string;
  title: string;
  body: string;
  sentAt: number;
}

@Injectable()
export class SentNotificationStore {
  private readonly sent: SentNotification[] = [];

  push(item: SentNotification) {
    this.sent.push(item);
    if (this.sent.length > 200) this.sent.shift();
  }

  list() {
    return [...this.sent];
  }
}
