import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BusinessException } from '@app/types';
import { EntityDetectionHistoryService } from './entity-detection-history.service';
import { EntityDetectionsQueryDto } from './dto/entity-detections-query.dto';

// Internal-only endpoint — port 5005 must be firewalled from the public internet.
// user_id is caller-supplied: the BFF passes the authenticated userId after verifying the JWT.
@ApiTags('Entity Detections')
@Controller('entity-detections')
export class EntityDetectionHistoryController {
  constructor(private readonly service: EntityDetectionHistoryService) {}

  @Get()
  @ApiOperation({
    summary:
      'Fetch persisted entity detections for a conversation (reload restore)',
  })
  @ApiQuery({ name: 'conversation_id', required: true })
  @ApiQuery({ name: 'user_id', required: true })
  @ApiResponse({
    status: 200,
    description: 'Per-message detected entities with offsets',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getDetections(@Query() query: EntityDetectionsQueryDto) {
    if (!query.conversation_id?.trim()) {
      throw BusinessException.badRequest(
        'conversation_id query parameter is required',
      );
    }
    if (!query.user_id?.trim()) {
      throw BusinessException.badRequest('user_id query parameter is required');
    }
    const items = await this.service.getForConversation(query.conversation_id);
    return { items };
  }
}
