export const WsEvents = {
  ChatJoin: 'chat:join',
  ChatLeave: 'chat:leave',
  ChatSend: 'chat:send',
  ChatMessage: 'chat:message',

  PresenceHeartbeat: 'presence:heartbeat',
  PresenceUpdate: 'presence:update',

  ChatAck: 'chat:ack',

  QrConfirmed: 'qr:confirmed',
  QrRejected: 'qr:rejected',
} as const;

export type WsEventName = (typeof WsEvents)[keyof typeof WsEvents];

export interface WsChatJoinPayload {
  conversation_id: string;
}

export interface WsChatSendPayload {
  message_id: string;
  conversation_id: string;
  body: string;
  sent_at: number;
}

export interface WsChatMessagePayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
}

export interface WsPresenceHeartbeatPayload {
  ts: number;
}

export interface WsPresenceUpdatePayload {
  user_id: string;
  status: 'online' | 'offline';
  last_seen_at: number;
  expires_at: number;
}

export interface WsChatAckPayload {
  message_id: string;
  status: 'accepted' | 'rejected';
  reason?: string;
}

// QR Code Login Payloads
export interface WsQrConfirmedPayload {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    phone: string;
    fullName: string;
    email?: string | null;
    avatarUrl?: string | null;
  };
}

export interface WsQrRejectedPayload {
  sessionId: string;
  reason: string;
}
