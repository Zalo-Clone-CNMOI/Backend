export interface MediaUploadRequestedEvent {
  key: string;
  bucket: string;
  content_type: string;
  requested_at: number;
  requested_by_user_id?: string;
  trace_id?: string;
}

export interface MediaUploadedEvent {
  key: string;
  bucket: string;
  uploaded_at: number;
  trace_id?: string;
}
