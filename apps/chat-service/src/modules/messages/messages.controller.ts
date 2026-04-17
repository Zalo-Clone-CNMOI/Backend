import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import {
  GetMessagesQueryDto,
  SearchMessagesQueryDto,
  MessageListResponseDto,
  MessageResponseDto,
  MessageReactionsResponseDto,
  MessageSearchResponseDto,
  ForwardMessageDto,
  ForwardMessageResultDto,
} from './dto';

@ApiTags('Messages')
@Controller('v1/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('lookup/:messageId')
  @ApiOperation({
    summary:
      'Look up a single message by message ID only (uses messages_by_id index)',
  })
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

  @Post('forward')
  @ApiOperation({ summary: 'Forward a message to one or more conversations' })
  @ApiHeader({
    name: 'x-user-id',
    required: true,
    description: 'Authenticated user id performing forward',
  })
  @ApiBody({ type: ForwardMessageDto })
  @ApiResponse({ status: 201, type: ForwardMessageResultDto })
  @ApiUnauthorizedResponse({ description: 'Missing x-user-id header' })
  async forwardMessage(
    @Body() body: ForwardMessageDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<ForwardMessageResultDto> {
    if (!userId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    return this.messagesService.forwardMessage(body, userId);
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
