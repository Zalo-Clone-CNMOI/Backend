import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '@app/decorator';
import { AuthenticatedUser } from '@app/types';
import { AiConversationFactoryService } from './services/ai-conversation-factory.service';
import { CreateDocumentConversationDto } from './dto/create-document-conversation.dto';

@ApiTags('AiConversations')
@ApiBearerAuth('BearerAuth')
@Controller('ai-conversations')
export class AiConversationController {
  constructor(private readonly factory: AiConversationFactoryService) {}

  @Post('general')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Get or create the general Zai AI conversation for the current user',
  })
  async getOrCreateGeneral(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ conversationId: string }> {
    return this.factory.getOrCreateGeneral(user.id);
  }

  @Post('document')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Get or create a Zai AI conversation anchored to a specific document',
  })
  async getOrCreateDocumentConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentConversationDto,
  ): Promise<{ conversationId: string }> {
    return this.factory.getOrCreateDocumentConversation(
      user.id,
      dto.documentId,
    );
  }

  @Post(':conversationId/disband')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Disband (delete) an AI conversation — creator only',
  })
  async disbandAiConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.factory.disbandAiConversation(user.id, conversationId);
  }
}
