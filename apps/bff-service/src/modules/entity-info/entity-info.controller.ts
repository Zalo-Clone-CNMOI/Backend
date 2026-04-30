import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { Throttle } from '@nestjs/throttler';
import { AccessToken } from '@app/decorator';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { EntityInfoService } from './entity-info.service';
import type { EntityType } from '@libs/contracts';
import { EntityInfoQueryDto } from './dto/entity-info-query.dto';
import { EntityInfoResponseDto } from './dto/entity-info-response.dto';

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
  @ApiResponse({
    status: 200,
    description: 'Entity info panel content',
    type: EntityInfoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getEntityInfo(
    @AccessToken() token: string,
    @Query() query: EntityInfoQueryDto,
  ) {
    const { userId } = this.jwtService.verifyToken(token);

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
    const language = query.lang === 'en' ? 'en' : 'vi';

    const result = await this.service.getEntityInfo({
      text,
      type: query.type as EntityType,
      lang: language,
      userId,
    });

    return plainToInstance(EntityInfoResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }
}
