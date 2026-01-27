import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';

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
