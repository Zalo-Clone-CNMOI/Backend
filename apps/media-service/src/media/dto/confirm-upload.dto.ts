export interface ConfirmUploadRequestDto {
  key: string;
  contentType: string;
  conversationId?: string;
}

export interface ConfirmUploadResponseDto {
  ok: true;
  thumbnailKey?: string;
}
