import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessToken } from '@app/decorator';
import { JwtService } from '@libs/auth';
import { EntityInfoService } from './entity-info.service';
import type { EntityType } from '@libs/contracts';

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
@ApiBearerAuth('BearerAuth')
@Controller('entity-info')
export class EntityInfoController {
  constructor(
    private readonly service: EntityInfoService,
    private readonly jwtService: JwtService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Fetch info panel content for a detected entity' })
  @ApiQuery({ name: 'text', required: true, description: 'Entity text' })
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
  @ApiResponse({ status: 200, description: 'Entity info panel content' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getEntityInfo(
    @AccessToken() token: string,
    @Query('text') text: string,
    @Query('type') type: string,
    @Query('lang') lang?: string,
  ) {
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
    const language = lang === 'en' ? 'en' : 'vi';
    const userId = this.jwtService.verifyToken(token).userId;

    return this.service.getEntityInfo(
      text.trim(),
      type as EntityType,
      language,
      userId,
    );
  }
}
