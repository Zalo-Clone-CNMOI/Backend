import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SsoClientService } from '@app/clients';
import { MediaClientService } from '@app/clients/media-client/media-client.service';
import {
  BffPresignUploadRequestDto,
  BffPresignUploadResponseDto,
  BffConfirmUploadRequestDto,
  BffConfirmUploadResponseDto,
  BffPresignDownloadRequestDto,
  BffPresignDownloadResponseDto,
} from './dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly mediaClient: MediaClientService,
    private readonly ssoClient: SsoClientService,
  ) {}

  async presignUpload(
    accessToken: string,
    dto: BffPresignUploadRequestDto,
  ): Promise<BffPresignUploadResponseDto> {
    const userId = await this.resolveUserId(accessToken);
    return this.mediaClient.presignUpload(dto, userId);
  }

  async confirmUpload(
    accessToken: string,
    dto: BffConfirmUploadRequestDto,
  ): Promise<BffConfirmUploadResponseDto> {
    const userId = await this.resolveUserId(accessToken);
    return this.mediaClient.confirmUpload(dto, userId);
  }

  async presignDownload(
    accessToken: string,
    dto: BffPresignDownloadRequestDto,
  ): Promise<BffPresignDownloadResponseDto> {
    const userId = await this.resolveUserId(accessToken);
    return this.mediaClient.presignDownload(dto, userId);
  }

  private async resolveUserId(accessToken: string): Promise<string> {
    if (!accessToken) {
      throw new UnauthorizedException('Authorization token required');
    }

    const profile = await this.ssoClient.getMyProfile(accessToken);
    if (!profile?.id) {
      throw new UnauthorizedException('Unable to resolve user id from token');
    }

    return profile.id;
  }
}
