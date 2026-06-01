import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AccessToken } from '@app/decorator';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { EntityDetectionsService } from './entity-detections.service';

export class EntityDetectionsQueryDto {
  @IsString()
  @IsNotEmpty()
  conversation_id?: string;
}

@ApiTags('Entity Detections')
@ApiBearerAuth('BearerAuth')
@Controller('entity-detections')
export class EntityDetectionsController {
  constructor(
    private readonly service: EntityDetectionsService,
    private readonly jwt: JwtService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Fetch entity detections for a conversation (reload restore)',
  })
  @ApiQuery({
    name: 'conversation_id',
    required: true,
    description: 'Conversation UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of messages with their detected entities',
  })
  @ApiResponse({ status: 400, description: 'Missing conversation_id' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getEntityDetections(
    @AccessToken() token: string | null,
    @Query() query: EntityDetectionsQueryDto,
  ) {
    if (!token) {
      throw BusinessException.unauthorized('Authentication required');
    }
    const { sub: userId } = this.jwt.verifyAccessToken(token);

    if (!query.conversation_id) {
      throw BusinessException.badRequest(
        'conversation_id query parameter is required',
      );
    }

    return this.service.getEntityDetections({
      conversationId: query.conversation_id,
      userId,
    });
  }
}
