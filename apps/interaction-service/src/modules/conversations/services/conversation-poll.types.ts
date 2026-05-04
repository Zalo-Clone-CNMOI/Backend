import { PollStatus } from '@app/constant';

export interface CreatePollInput {
  question: string;
  options: Array<{ label: string }>;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_in_hours?: number | null;
  is_anonymous?: boolean;
}

export interface CreatePollResult {
  poll_id: string;
  message_id: string;
  options: Array<{ option_id: string; label: string; order_index: number }>;
}

export interface ClosePollResult {
  poll_id: string;
  status: 'closed';
  final_tally: Array<{ option_id: string; vote_count: number }>;
}

export interface AddOptionResult {
  option_id: string;
  label: string;
  order_index: number;
}

export interface EditPollDto {
  question?: string;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_at?: string | null;
  edited_option_labels?: Array<{ option_id: string; label: string }>;
}

export interface EditPollResult {
  poll_id: string;
  edited_at: number;
}

export interface RemoveOptionResult {
  option_id: string;
}

export interface ListPollsQuery {
  status?: PollStatus;
  page?: number;
  limit?: number;
}

export interface PollListItem {
  poll_id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  status: PollStatus;
  allow_multiple: boolean;
  allow_add_option: boolean;
  expires_at: number | null;
  closed_at: number | null;
  created_at: number | undefined;
  options_count: number;
}

export interface ListPollsResult {
  items: PollListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PollDetailOption {
  option_id: string;
  label: string;
  order_index: number;
  vote_count: number;
  added_by_user_id: string | null;
}

export interface PollDetailResult {
  poll_id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  status: PollStatus;
  allow_multiple: boolean;
  allow_add_option: boolean;
  expires_at: number | null;
  closed_at: number | null;
  options: PollDetailOption[];
  my_vote: string[];
  total_votes: number;
}
