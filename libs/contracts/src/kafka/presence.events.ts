export interface PresenceConnectCommand {
  user_id: string;
  socket_id: string;
  connected_at: number;
  trace_id?: string;
}

export interface PresenceDisconnectCommand {
  user_id: string;
  socket_id: string;
  disconnected_at: number;
  trace_id?: string;
}

export interface PresenceHeartbeatCommand {
  user_id: string;
  socket_id: string;
  ts: number;
  trace_id?: string;
}

export type PresenceStatus = 'online' | 'offline';
export type PresenceSource =
  | 'connect'
  | 'disconnect'
  | 'heartbeat'
  | 'ttl_expire';

export interface PresenceUpdatedEvent {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: number;
  expires_at: number;
  source: PresenceSource;
  trace_id?: string;
}
