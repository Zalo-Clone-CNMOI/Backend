import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class FindMessageDto {
  @ApiPropertyOptional({
    description: 'Keyword to search in message body',
    example: 'Thì đó',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by sender UUID',
    example: '00000000-0000-0000-0000-000000000001',
  })
  @IsOptional()
  @IsUUID()
  senderId?: string;

  @ApiPropertyOptional({
    description: 'Filter messages created after this timestamp (epoch ms)',
    example: 1700000000000,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  from?: number;

  @ApiPropertyOptional({
    description: 'Filter messages created before this timestamp (epoch ms)',
    example: 1714000000000,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  to?: number;
}
