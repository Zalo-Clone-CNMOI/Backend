import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '@app/decorator';
import { CallHistoryService, PaginatedCallSessions } from './call-history.service';

@Controller('conversations/:conversationId/calls')
@Public()
export class CallHistoryController {
  constructor(private readonly callHistoryService: CallHistoryService) {}

  @Get()
  async list(
    @Param('conversationId') conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<PaginatedCallSessions> {
    return this.callHistoryService.listForConversation(
      conversationId,
      Number(page),
      Math.min(Number(limit), 50),
    );
  }
}
