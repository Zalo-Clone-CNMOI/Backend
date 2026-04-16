import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import {
  GetMessagesQueryDto,
  SearchMessagesQueryDto,
  MessageListResponseDto,
  MessageResponseDto,
  MessageReactionsResponseDto,
  MessageSearchResponseDto,
} from './dto';

@ApiTags('Messages')
@Controller('v1/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Internal-only endpoint used by bff-service to resolve a message from its
   * ID alone (without knowing conversation_id or created_at). This endpoint
   * performs no auth check because chat-service is an internal microservice
   * not directly reachable from the public internet — access is restricted at
   * the network/service-mesh layer. Callers are trusted to have already
   * verified the requesting user's identity.
   */
  @Get('lookup/:messageId')
  @ApiOperation({ summary: 'Look up a single message by message ID only (uses messages_by_id index)' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async getMessageById(
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponseDto> {
    const message = await this.messagesService.getMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  @Get(':conversationId/search')
  @ApiOperation({ summary: 'Search messages in a conversation by keyword' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiQuery({ name: 'q', required: false, description: 'Keyword to search' })
  @ApiQuery({
    name: 'senderId',
    required: false,
    description: 'Filter by sender UUID',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Filter from timestamp (epoch ms)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Filter to timestamp (epoch ms)',
  })
  @ApiResponse({ status: 200, type: MessageSearchResponseDto })
  async searchMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: SearchMessagesQueryDto,
  ): Promise<MessageSearchResponseDto> {
    return this.messagesService.searchMessages(conversationId, query);
  }

  @Get(':conversationId')
  @ApiOperation({
    summary: 'Get messages for a conversation with cursor pagination',
  })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of messages (max 100)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({ status: 200, type: MessageListResponseDto })
  async getMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: GetMessagesQueryDto,
  ): Promise<MessageListResponseDto> {
    return this.messagesService.getMessages(conversationId, query);
  }

  @Get(':conversationId/:createdAt/:messageId')
  @ApiOperation({ summary: 'Get a single message by ID' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'createdAt', description: 'Message created_at timestamp' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async getMessage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('createdAt') createdAt: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponseDto> {
    const message = await this.messagesService.getMessage(
      conversationId,
      parseInt(createdAt, 10),
      messageId,
    );

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  @Get(':messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a message' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiResponse({ status: 200, type: MessageReactionsResponseDto })
  async getReactions(
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageReactionsResponseDto> {
    return this.messagesService.getMessageReactions(messageId);
  }
}
