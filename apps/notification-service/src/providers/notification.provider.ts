export interface SendNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SendNotificationResult {
  ok: true;
}

export abstract class NotificationProvider {
  abstract send(input: SendNotificationInput): Promise<SendNotificationResult>;
}
