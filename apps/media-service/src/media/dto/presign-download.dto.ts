import { IsString, IsNotEmpty } from 'class-validator';

export class PresignDownloadRequestDto {
  @IsString()
  @IsNotEmpty()
  key: string;
}

export interface PresignDownloadResponseDto {
  downloadUrl: string;
  expiresAt: number;
}
