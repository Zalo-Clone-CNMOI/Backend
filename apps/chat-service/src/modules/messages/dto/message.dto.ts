import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsPositive,
  Max,
  IsUUID,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SearchFileTypes = ['images', 'video', 'files'] as const;
export type SearchFileType = (typeof SearchFileTypes)[number];

export class GetMessagesQueryDto {
  @ApiPropertyOptional({
    description: 'Number of messages to fetch',
    example: 50,
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Cursor for pagination (base64 encoded timestamp)',
    example: 'MTcwNjE2MjgwMDAwMA==',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class SearchMessagesQueryDto {
  @ApiPropertyOptional({
    description: 'Keyword to search in message body',
    example: 'Thì đó',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by sender ID (UUID)',
    example: '00000000-0000-0000-0000-000000000001',
  })
  @IsOptional()
  @IsUUID()
  senderId?: string;

  @ApiPropertyOptional({
    description: 'Filter messages created after this timestamp (epoch ms)',
    example: 1700000000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  from?: number;

  @ApiPropertyOptional({
    description: 'Filter messages created before this timestamp (epoch ms)',
    example: 1714000000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  to?: number;

  @ApiPropertyOptional({
    description: 'Filter messages by attachment group',
    enum: SearchFileTypes,
    example: 'images',
  })
  @IsOptional()
  @IsIn(SearchFileTypes)
  fileType?: SearchFileType;
}
