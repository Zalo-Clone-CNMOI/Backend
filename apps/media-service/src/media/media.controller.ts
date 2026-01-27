import { Body, Controller, Headers, Post } from '@nestjs/common';
import type {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/presign-upload.dto';
import type {
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
} from './dto/confirm-upload.dto';
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
    );
    return { ok: true, thumbnailKey: result.thumbnailKey };
  }
}
