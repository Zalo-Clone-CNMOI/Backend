import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityDetectionEngine } from './entity-detection.engine';
import type { EntityType, AiEntityInfoResultEvent } from '@libs/contracts';
import { BusinessException } from '@app/types';
import { EntityInfoQueryDto } from './dto/entity-info-query.dto';

const VALID_TYPES: readonly EntityType[] = [
  'tool',
  'company',
  'person',
  'concept',
  'location',
  'product',
  'other',
];

// Internal-only endpoint — port 5005 must be firewalled from public internet.
// user_id is caller-supplied (BFF passes authenticated userId).
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
    required: true,
    description: 'Authenticated user ID (supplied by BFF)',
  })
  @ApiResponse({ status: 200, description: 'Entity info panel content' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getInfo(
    @Query() query: EntityInfoQueryDto,
  ): Promise<AiEntityInfoResultEvent> {
    const text = query.text?.trim();
    if (!text) {
      throw BusinessException.badRequest('text query parameter is required');
    }
    if (text.length > 200) {
      throw BusinessException.badRequest('text exceeds 200 characters');
    }
    if (
      !query.type ||
      !(VALID_TYPES as readonly string[]).includes(query.type)
    ) {
      throw BusinessException.badRequest(
        `type must be one of: ${VALID_TYPES.join(', ')}`,
      );
    }

    if (!query.user_id?.trim()) {
      throw BusinessException.badRequest('user_id query parameter is required');
    }

    return this.engine.generateInfo({
      entity_text: text,
      entity_type: query.type as EntityType,
      user_id: query.user_id,
      language: query.lang === 'en' ? 'en' : 'vi',
    });
  }
}
