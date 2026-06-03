import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiExcludeEndpoint,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/presign-upload.dto';
import {
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
} from './dto/confirm-upload.dto';
import { PresignDownloadRequestDto } from './dto/presign-download.dto';
import { PresignDownloadResponseDto } from './dto/presign-download.dto';
import {
  CloneAttachmentRequestDto,
  CloneAttachmentResponseDto,
} from './dto/clone-attachment.dto';
import {
  ValidateAttachmentsRequestDto,
  ValidateAttachmentsResponseDto,
} from './dto/validate-attachments.dto';
import { MediaService } from './media.service';

@ApiTags('Media')
@Controller('v1/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign/upload')
  @ApiOperation({
    summary: 'Generate presigned upload URL',
    description:
      'Returns a short-lived signed URL and object key for uploading media directly to storage.',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: false,
    description: 'Optional caller user id for audit/event tracing',
  })
  @ApiBody({ type: PresignUploadRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Presigned upload URL generated',
    type: PresignUploadResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid request payload' })
  async presignUpload(
    @Body() body: PresignUploadRequestDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<PresignUploadResponseDto> {
    return this.media.presignUpload(body, userId);
  }

  @Post('upload/confirm')
  @ApiOperation({
    summary: 'Confirm uploaded object',
    description:
      'Confirms an object exists in storage and triggers post-processing events such as thumbnails and AI document ingestion.',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: false,
    description: 'Optional caller user id for audit/event tracing',
  })
  @ApiBody({ type: ConfirmUploadRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Upload confirmed',
    type: ConfirmUploadResponseDto,
  })
  @ApiBadRequestResponse({ description: 'File not found or invalid payload' })
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
    return {
      ok: true,
      thumbnailKey: result.thumbnailKey,
      documentId: result.documentId,
    };
  }

  @Post('presign/download')
  @ApiOperation({
    summary: 'Generate presigned download URL',
    description:
      'Generates a short-lived download URL after validating that the caller has access to this file.',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: true,
    description: 'Authenticated user id for media authorization',
  })
  @ApiBody({ type: PresignDownloadRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Presigned download URL generated',
    type: PresignDownloadResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing x-user-id header' })
  @ApiForbiddenResponse({ description: 'Caller has no access to this file' })
  @ApiBadRequestResponse({ description: 'Invalid request payload' })
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

  @Post('validate-attachments')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Validate attachment ownership and readiness',
    description:
      'Checks that all provided keys exist, are owned by the given user, and have status=uploaded. Used internally by ws-gateway before publishing a chat message.',
  })
  @ApiBody({ type: ValidateAttachmentsRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Validation result — error is null if all attachments are valid',
    type: ValidateAttachmentsResponseDto,
  })
  async validateAttachments(
    @Body() body: ValidateAttachmentsRequestDto,
  ): Promise<ValidateAttachmentsResponseDto> {
    const error = await this.media.validateAttachments(body.keys, body.user_id);
    return { error };
  }

  @Post('clone')
  @ApiOperation({
    summary: 'Clone a media attachment',
    description:
      'Copies an S3 object to a new key and creates a new MediaFile record. Used by the forward message flow.',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: true,
    description: 'ID of the user performing the forward',
  })
  @ApiBody({ type: CloneAttachmentRequestDto })
  @ApiResponse({ status: 201, type: CloneAttachmentResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing x-user-id header' })
  async cloneAttachment(
    @Body() body: CloneAttachmentRequestDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<CloneAttachmentResponseDto> {
    if (!userId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    return this.media.cloneAttachment(body, userId);
  }
}
