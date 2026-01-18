import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsInt, Min } from 'class-validator';

export class FindDTO {
  @ApiProperty({
    required: false,
    default: 1,
    description: 'Page for pagination',
  })
  @IsOptional()
  @IsInt()
  @Transform((params) => parseInt(params.value, 10))
  @Min(0)
  page?: number = 1;

  @ApiProperty({
    required: false,
    default: 10,
    description: 'Limit for pagination',
  })
  @IsOptional()
  @IsInt()
  @Transform((params) => parseInt(params.value, 10))
  @Min(1)
  limit?: number = 10;
}
