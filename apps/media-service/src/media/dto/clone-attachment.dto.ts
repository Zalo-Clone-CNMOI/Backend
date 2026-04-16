import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CloneAttachmentRequestDto {
  @ApiProperty({
    description: 'S3 key of the source file to clone',
    example: 'private/orig-abc.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Matches(/^(?!.*\.\.)([\w\-./@]+)$/, {
    message: 'source_key contains invalid characters',
  })
  source_key!: string;

  @ApiPropertyOptional({
    description: 'Target conversation ID for access control',
    example: 'conv-uuid',
  })
  @IsUUID()
  @IsOptional()
  conversation_id?: string;
}

export class CloneAttachmentResponseDto {
  @ApiProperty({
    description: 'S3 key of the cloned file',
    example: 'private/fwd-uuid',
  })
  cloned_key!: string;

  @ApiProperty({ enum: ['public', 'private'] })
  visibility!: 'public' | 'private';

  @ApiProperty({ description: 'MIME content type', example: 'image/jpeg' })
  content_type!: string;

  @ApiPropertyOptional({ description: 'File size in bytes', example: 51200 })
  size_bytes!: number | null;
}
