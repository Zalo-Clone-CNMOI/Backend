import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConfirmUploadRequestDto {
  @ApiProperty({
    description: 'Object key that was uploaded to storage',
    example: 'public/photo.jpg-1730000000000',
  })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({
    description: 'MIME content type of uploaded file',
    example: 'image/jpeg',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiPropertyOptional({
    description:
      'Conversation id for access checks and AI document ingest flow',
    example: '9a24776a-050d-4f76-9385-316eb2b2a0cd',
  })
  @IsString()
  @IsOptional()
  conversationId?: string;
}

export class ConfirmUploadResponseDto {
  @ApiProperty({
    description: 'Whether confirmation succeeded',
    example: true,
  })
  ok!: boolean;

  @ApiPropertyOptional({
    description: 'Generated thumbnail key for image uploads',
    example: 'thumbs/public/photo.jpg-1730000000000',
  })
  thumbnailKey?: string;
}
