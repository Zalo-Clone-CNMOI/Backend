import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatchUpEngine } from './catch-up.engine';
import { CatchUpQueryDto } from './dto/catch-up-query.dto';
import type { AiCatchUpResultEvent } from '@libs/contracts';
import { BusinessException } from '@app/types';

// Internal-only endpoint — port 5005 must be firewalled from the public internet.
// user_id is caller-supplied: the BFF passes the authenticated userId after verifying the JWT.
@ApiTags('Catch-Up Summary')
@Controller('catch-up')
export class CatchUpController {
  constructor(private readonly engine: CatchUpEngine) {}

  @Get()
  @ApiOperation({
    summary:
      'Summarise unread messages for a user in a conversation ("what did I miss?")',
  })
  @ApiQuery({
    name: 'conversation_id',
    required: true,
    description: 'UUID of the conversation',
  })
  @ApiQuery({
    name: 'user_id',
    required: true,
    description: 'Authenticated user ID (supplied by BFF)',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'Epoch-ms timestamp of last read position. Messages newer than this are considered unread.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max messages to include in the summary (server cap: 50)',
  })
  @ApiResponse({ status: 200, description: 'Catch-up summary result' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getCatchUp(
    @Query() query: CatchUpQueryDto,
  ): Promise<AiCatchUpResultEvent> {
    if (!query.conversation_id?.trim()) {
      throw BusinessException.badRequest(
        'conversation_id query parameter is required',
      );
    }

    if (!query.user_id?.trim()) {
      throw BusinessException.badRequest('user_id query parameter is required');
    }

    let since: number | undefined;
    if (query.since !== undefined) {
      const parsed = Number(query.since);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw BusinessException.badRequest(
          'since must be a non-negative numeric epoch ms value',
        );
      }
      since = parsed;
    }

    let limit: number | undefined;
    if (query.limit !== undefined) {
      const parsed = Number(query.limit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw BusinessException.badRequest(
          'limit must be a positive numeric value',
        );
      }
      limit = parsed;
    }

    return this.engine.summarizeUnread({
      conversation_id: query.conversation_id,
      user_id: query.user_id,
      since,
      limit,
    });
  }
}
