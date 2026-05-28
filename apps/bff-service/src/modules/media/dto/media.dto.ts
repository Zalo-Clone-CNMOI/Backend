import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BffPresignUploadRequestDto {
  @ApiProperty({
    description: 'MIME content type of uploaded file',
    example: 'image/jpeg',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiPropertyOptional({
    description: 'Original file name',
    example: 'photo.jpg',
  })
  @IsString()
  @IsOptional()
  fileName?: string;
}

export class BffPresignUploadResponseDto {
  @ApiProperty({ example: 'public/photo.jpg-1730000000000' })
  key!: string;

  @ApiProperty({ example: 'zalo-media-prod' })
  bucket!: string;

  @ApiProperty({ example: 'https://s3.example.com/bucket/key?signature=abc' })
  uploadUrl!: string;

  @ApiProperty({ example: 1730000015000 })
  expiresAt!: number;

  @ApiProperty({ enum: ['public', 'private'], example: 'public' })
  visibility!: 'public' | 'private';
}

export class BffConfirmUploadRequestDto {
  @ApiProperty({ example: 'public/photo.jpg-1730000000000' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiPropertyOptional({
    description: 'Conversation id for AI document ingestion context',
    example: '9a24776a-050d-4f76-9385-316eb2b2a0cd',
  })
  @IsString()
  @IsOptional()
  conversationId?: string;
}

export class BffConfirmUploadResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiPropertyOptional({ example: 'thumbs/public/photo.jpg-1730000000000' })
  thumbnailKey?: string;

  @ApiPropertyOptional({
    description:
      'Document metadata id (UUID v4). Present only when the upload is a document (PDF / Word / etc.) within a conversation. Pass it to POST /api/ai-assist/conversations/document to open a Zai document chat.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  documentId?: string;
}

export class BffPresignDownloadRequestDto {
  @ApiProperty({ example: 'private/docs/report.pdf-1730000000000' })
  @IsString()
  @IsNotEmpty()
  key!: string;
}

export class BffPresignDownloadResponseDto {
  @ApiProperty({ example: 'https://s3.example.com/bucket/key?signature=xyz' })
  downloadUrl!: string;

  @ApiProperty({ example: 1730000015000 })
  expiresAt!: number;
}
