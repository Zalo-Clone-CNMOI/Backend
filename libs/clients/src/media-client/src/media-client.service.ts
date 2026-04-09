import { Injectable, Logger } from '@nestjs/common';
import { MediaApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
  PresignDownloadRequestDto,
  PresignDownloadResponseDto,
} from './client/generated';

@Injectable()
export class MediaClientService extends BaseHttpClient {
  protected readonly logger = new Logger(MediaClientService.name);

  constructor(private readonly mediaApi: MediaApi) {
    super();
  }

  async presignUpload(
    dto: PresignUploadRequestDto,
    userId?: string,
  ): Promise<PresignUploadResponseDto> {
    try {
      const response = await this.mediaApi.presignUpload({
        presignUploadRequestDto: dto,
        xUserId: userId,
      });
      return response.data;
    } catch (error) {
      this.handleError('presignUpload', error);
    }
  }

  async confirmUpload(
    dto: ConfirmUploadRequestDto,
    userId?: string,
  ): Promise<ConfirmUploadResponseDto> {
    try {
      const response = await this.mediaApi.confirmUpload({
        confirmUploadRequestDto: dto,
        xUserId: userId,
      });
      return response.data;
    } catch (error) {
      this.handleError('confirmUpload', error);
    }
  }

  async presignDownload(
    dto: PresignDownloadRequestDto,
    userId: string,
  ): Promise<PresignDownloadResponseDto> {
    try {
      const response = await this.mediaApi.presignDownload({
        xUserId: userId,
        presignDownloadRequestDto: dto,
      });
      return response.data;
    } catch (error) {
      this.handleError('presignDownload', error);
    }
  }
}
