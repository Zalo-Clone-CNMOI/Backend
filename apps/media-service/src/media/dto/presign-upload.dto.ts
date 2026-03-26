export interface PresignUploadRequestDto {
  contentType: string;
  fileName?: string;
}

export interface PresignUploadResponseDto {
  key: string;
  bucket: string;
  uploadUrl: string;
  expiresAt: number;
  visibility: 'public' | 'private';
}
