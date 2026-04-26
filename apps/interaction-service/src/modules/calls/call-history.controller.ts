import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  CallHistoryService,
  PaginatedCallSessions,
} from './services/call-history.service';

@Controller('conversations/:conversationId/calls')
export class CallHistoryController {
  constructor(private readonly callHistoryService: CallHistoryService) {}

  @Get()
  async list(
    @Param('conversationId') conversationId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<PaginatedCallSessions> {
    return this.callHistoryService.listForConversation(
      conversationId,
      page,
      Math.min(limit, 50),
    );
  }
}
