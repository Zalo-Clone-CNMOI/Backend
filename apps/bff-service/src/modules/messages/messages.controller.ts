import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { AccessToken } from '@app/decorator';
import { FindMessageDto } from './dto/find-message.dto';

@ApiTags('Messages')
@ApiBearerAuth('BearerAuth')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get(':conversationId/search')
  @ApiOperation({ summary: 'Search messages in a conversation by keyword' })
  @ApiResponse({ status: 200, description: 'Matched messages' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchMessages(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Query() dto: FindMessageDto,
  ) {
    return this.messagesService.searchMessages(
      token,
      conversationId,
      dto.q,
      dto.senderId,
      dto.from,
      dto.to,
    );
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of messages to return',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getMessages(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.messagesService.getMessages(
      token,
      conversationId,
      cursor,
      limit,
    );
  }

  @Get(':conversationId/:createdAt/:messageId')
  @ApiOperation({ summary: 'Get a specific message' })
  @ApiResponse({
    status: 200,
    description: 'Message retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async getMessage(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('createdAt', ParseIntPipe) createdAt: number,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessage(
      token,
      conversationId,
      createdAt,
      messageId,
    );
  }

  @Get(':messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a message' })
  @ApiResponse({
    status: 200,
    description: 'Message reactions retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async getMessageReactions(
    @AccessToken() token: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessageReactions(token, messageId);
  }
}
