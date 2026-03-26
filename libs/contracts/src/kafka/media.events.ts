export interface MediaUploadRequestedEvent {
  key: string;
  bucket: string;
  content_type: string;
  visibility: 'public' | 'private';
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

export interface MediaThumbnailGeneratedEvent {
  original_key: string;
  thumbnail_key: string;
  bucket: string;
  width: number;
  height: number;
  generated_at: number;
  trace_id?: string;
}
