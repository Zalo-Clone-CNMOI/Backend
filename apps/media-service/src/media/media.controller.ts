import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/presign-upload.dto';
import type {
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
} from './dto/confirm-upload.dto';
import { PresignDownloadRequestDto } from './dto/presign-download.dto';
import type { PresignDownloadResponseDto } from './dto/presign-download.dto';
import { MediaService } from './media.service';

@Controller('v1/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign/upload')
  async presignUpload(
    @Body() body: PresignUploadRequestDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<PresignUploadResponseDto> {
    return this.media.presignUpload(body, userId);
  }

  @Post('upload/confirm')
  async confirmUpload(
    @Body() body: ConfirmUploadRequestDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<ConfirmUploadResponseDto> {
    const result = await this.media.confirmUploaded(
      body.key,
      body.contentType,
      userId,
      body.conversationId,
    );
    return { ok: true, thumbnailKey: result.thumbnailKey };
  }

  @Post('presign/download')
  async presignDownload(
    @Body() body: PresignDownloadRequestDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<PresignDownloadResponseDto> {
    if (!userId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }

    const allowed = await this.media.canUserAccessFile(body.key, userId);
    if (!allowed) {
      throw new ForbiddenException('You do not have access to this file');
    }

    return this.media.presignDownload(body.key);
  }
}
