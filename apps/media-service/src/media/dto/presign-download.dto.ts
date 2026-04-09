import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class PresignDownloadRequestDto {
  @ApiProperty({
    description: 'Object key to download',
    example: 'private/docs/report.pdf-1730000000000',
  })
  @IsString()
  @IsNotEmpty()
  key!: string;
}

export class PresignDownloadResponseDto {
  @ApiProperty({
    description: 'Presigned download URL',
    example: 'https://s3.example.com/bucket/key?signature=xyz',
  })
  downloadUrl!: string;

  @ApiProperty({
    description: 'Unix timestamp in milliseconds when URL expires',
    example: 1730000015000,
  })
  expiresAt!: number;
}
