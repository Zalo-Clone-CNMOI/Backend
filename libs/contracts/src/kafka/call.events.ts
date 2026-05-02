export type CallType = 'audio' | 'video';

export type CallStatus = 'ringing' | 'ongoing' | 'ended';

export type CallParticipantStatus =
  | 'invited'
  | 'accepted'
  | 'rejected'
  | 'left';

export type CallSignalType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'renegotiate';

export type CallConversationType = 'direct' | 'group';

export interface CallStateSnapshot {
  call_id: string;
  conversation_id: string;
  conversation_type: CallConversationType;
  call_type: CallType;
  status: CallStatus;
  initiator_id: string;
  participants: Record<string, CallParticipantStatus>;
  started_at: number;
  ended_at?: number;
  trace_id?: string;
  version?: number;
}

export interface CallStartCommand {
  call_id: string;
  conversation_id: string;
  conversation_type: CallConversationType;
  initiator_id: string;
  call_type: CallType;
  participant_ids?: string[];
  started_at: number;
  trace_id?: string;
}

export interface CallStartedEvent {
  call_id: string;
  conversation_id: string;
  initiator_id: string;
  call_type: CallType;
  participant_ids: string[];
  started_at: number;
  trace_id?: string;
  push_recipient_ids?: string[]; // participant_ids minus initiator, for VoIP push
}

export interface CallSignalCommand {
  call_id: string;
  conversation_id: string;
  sender_id: string;
  target_user_id?: string;
  signal_type: CallSignalType;
  sdp?: string;
  candidate?: string;
  sdp_mid?: string;
  sdp_mline_index?: number;
  sent_at: number;
  trace_id?: string;
}

export interface CallSignalForwardedEvent {
  call_id: string;
  conversation_id: string;
  sender_id: string;
  target_user_id?: string;
  signal_type: CallSignalType;
  sdp?: string;
  candidate?: string;
  sdp_mid?: string;
  sdp_mline_index?: number;
  sent_at: number;
  trace_id?: string;
  state_version?: number;
}

export interface CallAcceptCommand {
  call_id: string;
  conversation_id: string;
  user_id: string;
  accepted_at: number;
  trace_id?: string;
}

export interface CallAcceptedEvent {
  call_id: string;
  conversation_id: string;
  user_id: string;
  accepted_at: number;
  trace_id?: string;
  participants?: Record<string, CallParticipantStatus>;
  status?: CallStatus;
  state_version?: number;
}

export interface CallRejectCommand {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  rejected_at: number;
  trace_id?: string;
}

export interface CallRejectedEvent {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  rejected_at: number;
  trace_id?: string;
}

export interface CallEndCommand {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  ended_at: number;
  trace_id?: string;
}

export interface CallEndedEvent {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  ended_at: number;
  trace_id?: string;
}

export interface CallLeaveCommand {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  left_at: number;
  trace_id?: string;
}

export interface CallLeftEvent {
  call_id: string;
  conversation_id: string;
  user_id: string;
  reason?: string;
  left_at: number;
  trace_id?: string;
}

export interface CallStateRequestCommand {
  conversation_id: string;
  user_id: string;
  requested_at: number;
  trace_id?: string;
}

export interface CallStateUpdatedEvent {
  conversation_id: string;
  state: CallStateSnapshot | null;
  requested_by?: string;
  updated_at: number;
  reason?: string;
  trace_id?: string;
  /** Extra context for reasons like 'not_member', 'target_not_in_call'. */
  details?: Record<string, unknown>;
}

export interface CallTimeoutCommand {
  call_id: string;
  conversation_id: string;
  scheduled_at: number;
  trace_id?: string;
}

export interface CallTimedOutEvent {
  call_id: string;
  conversation_id: string;
  timed_out_at: number;
  trace_id?: string;
}
