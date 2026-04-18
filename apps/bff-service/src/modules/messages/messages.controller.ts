import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MessagesService } from './messages.service';
import { AccessToken } from '@app/decorator';
import { FindMessageDto } from './dto/find-message.dto';
import {
  ForwardMessageDto,
  ForwardMessageResultDto,
} from './dto/forward-message.dto';

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
      dto.fileType,
    );
  }

  @Get(':conversationId/pins')
  @ApiOperation({ summary: 'Get pinned messages in a conversation' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max pinned messages to return',
    type: Number,
  })
  @ApiResponse({ status: 200, description: 'Pinned messages retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPinnedMessages(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
  ) {
    const userId = MessagesController.decodeUserId(token);
    return this.messagesService.getPinnedMessages(
      token,
      conversationId,
      userId,
      limit,
    );
  }

  @Post(':conversationId/:createdAt/:messageId/pin')
  @ApiOperation({ summary: 'Pin a message' })
  @ApiResponse({ status: 201, description: 'Message pinned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async pinMessage(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('createdAt', ParseIntPipe) createdAt: number,
    @Param('messageId') messageId: string,
  ) {
    const userId = MessagesController.decodeUserId(token);
    return this.messagesService.pinMessage(
      token,
      conversationId,
      createdAt,
      messageId,
      userId,
    );
  }

  @Delete(':conversationId/:createdAt/:messageId/pin')
  @ApiOperation({ summary: 'Unpin a message' })
  @ApiResponse({ status: 200, description: 'Message unpinned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unpinMessage(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('createdAt', ParseIntPipe) createdAt: number,
    @Param('messageId') messageId: string,
  ) {
    const userId = MessagesController.decodeUserId(token);
    return this.messagesService.unpinMessage(
      token,
      conversationId,
      createdAt,
      messageId,
      userId,
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

  @Post('forward')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Forward a message to one or more conversations' })
  @ApiBody({ type: ForwardMessageDto })
  @ApiResponse({ status: 201, description: 'Forward operation result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Source message not found' })
  async forwardMessage(
    @Body() body: ForwardMessageDto,
    @AccessToken() accessToken: string,
  ): Promise<ForwardMessageResultDto> {
    const userId = MessagesController.decodeUserId(accessToken);
    return this.messagesService.forwardMessage(body, accessToken, userId);
  }

  private static decodeUserId(token: string): string {
    try {
      const parts = token.split('.');
      if (parts.length < 3) throw new Error('Malformed JWT');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString(),
      ) as { sub?: string };
      if (!payload.sub) throw new Error('Missing sub');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
