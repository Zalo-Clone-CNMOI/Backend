import { Injectable, Logger } from '@nestjs/common';
import { MessagesApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  MessageListResponseDto,
  MessageResponseDto,
  MessageReactionsResponseDto,
  MessageSearchResponseDto,
} from './client/generated';

@Injectable()
export class ChatClientService extends BaseHttpClient {
  protected readonly logger = new Logger(ChatClientService.name);

  constructor(private readonly messagesApi: MessagesApi) {
    super();
  }

  // ==================== MESSAGE METHODS ====================

  /**
   * Get messages for a conversation with cursor pagination
   */
  async getMessages(
    accessToken: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<MessageListResponseDto> {
    try {
      const response = await this.messagesApi.getMessages(
        {
          conversationId,
          cursor,
          limit,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessages', error);
    }
  }

  /**
   * Get a single message by ID
   */
  async getMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
  ): Promise<MessageResponseDto> {
    try {
      const response = await this.messagesApi.getMessage(
        {
          conversationId,
          createdAt: createdAt.toString(),
          messageId,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessage', error);
    }
  }

  /**
   * Search messages in a conversation by keyword
   */
  async searchMessages(
    accessToken: string,
    conversationId: string,
    q?: string,
    senderId?: string,
    from?: number,
    to?: number,
  ): Promise<MessageSearchResponseDto> {
    try {
      const response = await this.messagesApi.searchMessages(
        { conversationId, q, senderId, from, to },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('searchMessages', error);
    }
  }

  /**
   * Get reactions for a message
   */
  async getMessageReactions(
    accessToken: string,
    messageId: string,
  ): Promise<MessageReactionsResponseDto> {
    try {
      const response = await this.messagesApi.getReactions(
        {
          messageId,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessageReactions', error);
    }
  }
}
