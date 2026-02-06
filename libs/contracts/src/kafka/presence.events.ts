interface PresenceCommandBase {
  event_id: string;
  emitted_at: number;
  trace_id?: string;
}

export interface PresenceConnectCommand extends PresenceCommandBase {
  user_id: string;
  socket_id: string;
  connected_at: number;
}

export interface PresenceDisconnectCommand extends PresenceCommandBase {
  user_id: string;
  socket_id: string;
  disconnected_at: number;
}

export interface PresenceHeartbeatCommand extends PresenceCommandBase {
  user_id: string;
  socket_id: string;
  ts: number;
}

export type PresenceStatus = 'online' | 'offline';

/**
 * Source of presence change with distinct offline types
 */
export type PresenceSource =
  | 'connect'
  | 'disconnect'
  | 'heartbeat'
  | 'ttl_expire'
  | 'network_drop';

/**
 * Offline reason for debugging and metrics
 */
export type OfflineReason =
  | 'logical_disconnect'
  | 'network_drop'
  | 'ttl_expire'
  | 'cleanup';

export interface PresenceUpdatedEvent {
  version: 'v1';
  user_id: string;
  status: PresenceStatus;
  last_seen_at: number;
  expires_at: number;
  source: PresenceSource;
  offline_reason?: OfflineReason;
  socket_count: number;
  trace_id?: string;
}
