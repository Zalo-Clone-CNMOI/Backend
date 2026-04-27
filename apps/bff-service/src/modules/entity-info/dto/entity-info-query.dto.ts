import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EntityInfoQueryDto {
  @ApiProperty({
    description: 'Entity text',
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
}
