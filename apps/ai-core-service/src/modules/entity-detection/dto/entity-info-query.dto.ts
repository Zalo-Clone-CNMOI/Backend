import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EntityInfoQueryDto {
  @ApiProperty({
    description: 'Entity text (max 200 chars)',
    example: 'React',
  })
  text!: string;

  @ApiProperty({
    description: 'Entity type',
    example: 'tool',
  })
  type!: string;

  @ApiPropertyOptional({
    description: 'Output language (default: vi)',
    enum: ['vi', 'en'],
  })
  lang?: string;

  @ApiPropertyOptional({
    description: 'Requesting user ID',
  })
  user_id?: string;
}
