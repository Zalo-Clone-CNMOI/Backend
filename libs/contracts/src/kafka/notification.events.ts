export type NotificationChannel = 'push';

export interface NotificationRequestedEvent {
  channel: NotificationChannel;
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  requested_at: number;
  trace_id?: string;
}

export interface NotificationSentEvent {
  provider: 'mock';
  channel: NotificationChannel;
  user_id: string;
  sent_at: number;
  trace_id?: string;
}
