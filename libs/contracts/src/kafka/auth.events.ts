export interface QrUserInfo {
  id: string;
  phone: string;
  fullName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface AuthQrConfirmedEvent {
  sessionId: string;
  socketId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: QrUserInfo;
}

export interface AuthQrRejectedEvent {
  sessionId: string;
  socketId: string;
  reason: string;
}
