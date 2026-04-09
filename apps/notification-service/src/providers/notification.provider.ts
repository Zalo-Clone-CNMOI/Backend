// ── DI Token ───────────────────────────────────────────────────────────
export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

// ── Interfaces ─────────────────────────────────────────────────────────
export interface SendNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  priority?: 'normal' | 'high';
}

export interface SendNotificationResult {
  ok: boolean;
  successCount: number;
  failureCount: number;
}

export interface INotificationProvider {
  send(
    input: SendNotificationInput,
  ): Promise<SendNotificationResult> | SendNotificationResult;
}
