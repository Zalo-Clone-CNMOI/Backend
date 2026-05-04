import type { AxiosInstance } from 'axios';

export interface CreatePollPayload {
  question: string;
  options: { label: string }[];
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  is_anonymous?: boolean;
  expires_in_hours?: number;
}

export interface EditPollPayload {
  question?: string;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_at?: string | null;
  edited_option_labels?: { option_id: string; label: string }[];
}

export interface ListPollsQueryPayload {
  status?: string;
  page?: number;
  limit?: number;
}

export interface IceServerConfigEntry {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  username: string;
  credential: string;
  ttl: number;
  ice_servers: IceServerConfigEntry[];
}

export interface CallHistoryItem {
  id: string;
  conversationId: string;
  initiatorId: string;
  callType: 'audio' | 'video';
  conversationType: 'direct' | 'group';
  status: 'completed' | 'missed' | 'rejected' | 'timeout';
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  participantIds: string[];
  reason: string | null;
}

export interface CallHistoryResponse {
  items: CallHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export type ApiInternals = {
  axios: AxiosInstance;
  basePath: string;
};
