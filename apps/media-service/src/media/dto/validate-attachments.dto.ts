import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  ArrayMaxSize,
  Matches,
  MaxLength,
} from 'class-validator';

export class ValidateAttachmentsRequestDto {
  @ApiProperty({
    description: 'S3 keys of the files to validate',
    example: ['private/file-1.jpg', 'private/file-2.pdf'],
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(1024, { each: true })
  @Matches(/^(?!.*\.\.)([\w\-./@]+)$/, {
    each: true,
    message: 'key contains invalid characters',
  })
  keys!: string[];

  @ApiProperty({ description: 'ID of the requesting user for ownership check' })
  @IsString()
  @IsNotEmpty()
  user_id!: string;
}

export class ValidateAttachmentsResponseDto {
  @ApiProperty({
    description: 'null if all valid, otherwise the rejection reason',
    nullable: true,
    example: null,
  })
  error!: string | null;
}
