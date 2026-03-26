export interface PresignDownloadRequestDto {
  key: string;
}

export interface PresignDownloadResponseDto {
  downloadUrl: string;
  expiresAt: number;
}
