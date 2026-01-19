export enum QrSessionStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface QrLoginSession {
  sessionId: string;
  qrToken: string;
  status: QrSessionStatus;
  socketId: string;
  pcDeviceInfo?: string;
  userId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface QrConfirmResult {
  success: boolean;
  alreadyConfirmed?: boolean;
  session?: QrLoginSession;
}
