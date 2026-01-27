export interface ConfirmUploadRequestDto {
  key: string;
  contentType: string;
}

export interface ConfirmUploadResponseDto {
  ok: true;
  thumbnailKey?: string;
}
