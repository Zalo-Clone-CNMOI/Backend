import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityDetectionEngine } from './entity-detection.engine';
import type { EntityType, AiEntityInfoResultEvent } from '@libs/contracts';

const VALID_TYPES: readonly EntityType[] = [
  'tool',
  'company',
  'person',
  'concept',
  'location',
  'product',
  'other',
];

@ApiTags('Entity Info')
@Controller('entity-info')
export class EntityInfoController {
  constructor(private readonly engine: EntityDetectionEngine) {}

  @Get()
  @ApiOperation({
    summary: 'Generate info panel content for a detected entity',
  })
  @ApiQuery({
    name: 'text',
    required: true,
    description: 'Entity text (max 200 chars)',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: VALID_TYPES as readonly string[],
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    enum: ['vi', 'en'],
    description: 'Output language (default: vi)',
  })
  @ApiQuery({
    name: 'user_id',
    required: false,
    description: 'Requesting user ID',
  })
  @ApiResponse({ status: 200, description: 'Entity info panel content' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getInfo(
    @Query('text') text: string,
    @Query('type') type: string,
    @Query('lang') lang?: string,
    @Query('user_id') userId?: string,
  ): Promise<AiEntityInfoResultEvent> {
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('text query parameter is required');
    }
    if (text.length > 200) {
      throw new BadRequestException('text exceeds 200 characters');
    }
    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(
        `type must be one of: ${VALID_TYPES.join(', ')}`,
      );
    }

    return this.engine.generateInfo({
      entity_text: text.trim(),
      entity_type: type as EntityType,
      user_id: userId ?? 'system',
      language: lang === 'en' ? 'en' : 'vi',
    });
  }
}
