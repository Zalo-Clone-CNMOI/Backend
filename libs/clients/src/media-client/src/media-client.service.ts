import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
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
import type { MediaClientConfig } from './utils/providers';

export interface CloneAttachmentRequest {
  source_key: string;
  conversation_id?: string;
}

export interface CloneAttachmentResponse {
  cloned_key: string;
  visibility: 'public' | 'private';
  content_type: string;
  size_bytes: number | null;
}

@Injectable()
export class MediaClientService extends BaseHttpClient {
  protected readonly logger = new Logger(MediaClientService.name);

  constructor(
    private readonly mediaApi: MediaApi,
    @Inject('MEDIA_CLIENT_CONFIG') private readonly config: MediaClientConfig,
    private readonly httpService: HttpService,
  ) {
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

  async validateAttachments(
    keys: string[],
    userId: string,
  ): Promise<string | null> {
    try {
      const response = await this.httpService.axiosRef.post<{ error: string | null }>(
        `${this.config.baseUrl}/v1/media/validate-attachments`,
        { keys, user_id: userId },
      );
      return response.data.error;
    } catch (error) {
      this.handleError('validateAttachments', error);
    }
  }

  async cloneAttachment(
    dto: CloneAttachmentRequest,
    userId: string,
  ): Promise<CloneAttachmentResponse> {
    try {
      const response =
        await this.httpService.axiosRef.post<CloneAttachmentResponse>(
          `${this.config.baseUrl}/v1/media/clone`,
          dto,
          { headers: { 'x-user-id': userId } },
        );
      return response.data;
    } catch (error) {
      this.handleError('cloneAttachment', error);
    }
  }
}
