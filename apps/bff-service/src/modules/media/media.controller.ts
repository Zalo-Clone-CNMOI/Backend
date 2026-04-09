import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AccessToken } from '@app/decorator';
import { MediaService } from './media.service';
import {
  BffPresignUploadRequestDto,
  BffPresignUploadResponseDto,
  BffConfirmUploadRequestDto,
  BffConfirmUploadResponseDto,
  BffPresignDownloadRequestDto,
  BffPresignDownloadResponseDto,
} from './dto';

@ApiTags('Media')
@ApiBearerAuth('BearerAuth')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('presign/upload')
  @ApiOperation({
    summary: 'Generate presigned upload URL',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned upload URL generated',
    type: BffPresignUploadResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authorization token required' })
  async presignUpload(
    @AccessToken() accessToken: string | null,
    @Body() dto: BffPresignUploadRequestDto,
  ): Promise<BffPresignUploadResponseDto> {
    if (!accessToken) {
      throw new UnauthorizedException('Authorization token required');
    }

    return this.mediaService.presignUpload(accessToken, dto);
  }

  @Post('upload/confirm')
  @ApiOperation({
    summary: 'Confirm uploaded object',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload confirmed',
    type: BffConfirmUploadResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authorization token required' })
  async confirmUpload(
    @AccessToken() accessToken: string | null,
    @Body() dto: BffConfirmUploadRequestDto,
  ): Promise<BffConfirmUploadResponseDto> {
    if (!accessToken) {
      throw new UnauthorizedException('Authorization token required');
    }

    return this.mediaService.confirmUpload(accessToken, dto);
  }

  @Post('presign/download')
  @ApiOperation({
    summary: 'Generate presigned download URL',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned download URL generated',
    type: BffPresignDownloadResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authorization token required' })
  async presignDownload(
    @AccessToken() accessToken: string | null,
    @Body() dto: BffPresignDownloadRequestDto,
  ): Promise<BffPresignDownloadResponseDto> {
    if (!accessToken) {
      throw new UnauthorizedException('Authorization token required');
    }

    return this.mediaService.presignDownload(accessToken, dto);
  }
}
