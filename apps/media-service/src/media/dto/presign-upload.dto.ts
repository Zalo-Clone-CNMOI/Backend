import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PresignUploadRequestDto {
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

export class PresignUploadResponseDto {
  @ApiProperty({
    description: 'Generated object key in storage',
    example: 'public/photo.jpg-1730000000000',
  })
  key!: string;

  @ApiProperty({
    description: 'S3 bucket name',
    example: 'zalo-media-prod',
  })
  bucket!: string;

  @ApiProperty({
    description: 'Presigned upload URL',
    example: 'https://s3.example.com/bucket/key?signature=abc',
  })
  uploadUrl!: string;

  @ApiProperty({
    description: 'Unix timestamp in milliseconds when URL expires',
    example: 1730000015000,
  })
  expiresAt!: number;

  @ApiProperty({
    enum: ['public', 'private'],
    description: 'Resolved media visibility from content type',
    example: 'public',
  })
  visibility!: 'public' | 'private';
}
