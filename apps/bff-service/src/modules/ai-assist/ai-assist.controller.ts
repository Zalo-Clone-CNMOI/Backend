import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessToken, CurrentUser } from '@app/decorator';
import { AuthenticatedUser, BusinessException } from '@app/types';
import { AiAssistService } from './ai-assist.service';
import { CatchUpResponseDto } from './dto/catch-up-response.dto';
import { ZaiConversationResponseDto } from './dto/zai-conversation-response.dto';
import { CreateDocumentConversationDto } from './dto/create-document-conversation.dto';

@ApiTags('AI Assist')
@ApiBearerAuth('BearerAuth')
@Controller('ai-assist')
export class AiAssistController {
  constructor(private readonly service: AiAssistService) {}

  @Post('conversations/zai')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Get or create the personal Zai AI conversation for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation id returned (created or existing)',
    type: ZaiConversationResponseDto,
  })
  async getOrCreateZaiConversation(
    @AccessToken() token: string,
  ): Promise<ZaiConversationResponseDto> {
    return this.service.getOrCreateZaiConversation(token);
  }

  @Post('conversations/document')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Get or create a Zai AI conversation anchored to a specific document',
  })
  @ApiResponse({
    status: 200,
    description: 'Document conversation id returned (created or existing)',
    type: ZaiConversationResponseDto,
  })
  async getOrCreateDocumentConversation(
    @AccessToken() token: string,
    @Body() dto: CreateDocumentConversationDto,
  ): Promise<ZaiConversationResponseDto> {
    return this.service.getOrCreateDocumentConversation(token, dto.documentId);
  }

  @Post('conversations/:conversationId/disband')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Disband (delete) an AI conversation — creator only',
  })
  @ApiResponse({ status: 200, description: 'AI conversation disbanded' })
  @ApiResponse({
    status: 403,
    description: 'Not the creator of this conversation',
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async disbandAiConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ): Promise<{ message: string }> {
    if (!conversationId?.trim()) {
      throw BusinessException.badRequest('conversationId is required');
    }
    return this.service.disbandAiConversation(token, conversationId);
  }

  @Get('conversations/:conversationId/catch-up')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Catch-up summary — "what did I miss?" for unread messages',
  })
  @ApiResponse({
    status: 200,
    description: 'Catch-up summary returned successfully',
    type: CatchUpResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Not a member of this conversation',
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getCatchUp(
    @CurrentUser() user: AuthenticatedUser,
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ): Promise<CatchUpResponseDto> {
    if (!conversationId?.trim()) {
      throw BusinessException.badRequest('conversationId is required');
    }
    return this.service.catchUp(token, user.id, conversationId);
  }
}
