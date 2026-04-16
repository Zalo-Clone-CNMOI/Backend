import { Injectable, Logger } from '@nestjs/common';
import { MessagesApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  ForwardMessageDto,
  ForwardMessageResultDto,
  MessageListResponseDto,
  MessageReactionsResponseDto,
  MessageResponseDto,
  MessageSearchResponseDto,
} from './client/generated';

@Injectable()
export class ChatClientService extends BaseHttpClient {
  protected readonly logger = new Logger(ChatClientService.name);

  constructor(private readonly messagesApi: MessagesApi) {
    super();
  }

  async getMessages(
    accessToken: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<MessageListResponseDto> {
    try {
      const response = await this.messagesApi.getMessages(
        { conversationId, cursor, limit },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessages', error);
    }
  }

  async getMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
  ): Promise<MessageResponseDto> {
    try {
      const response = await this.messagesApi.getMessage(
        { conversationId, createdAt: createdAt.toString(), messageId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessage', error);
    }
  }

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

  async getMessageReactions(
    accessToken: string,
    messageId: string,
  ): Promise<MessageReactionsResponseDto> {
    try {
      const response = await this.messagesApi.getReactions(
        { messageId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getMessageReactions', error);
    }
  }

  async forwardMessage(
    accessToken: string,
    dto: ForwardMessageDto,
    userId: string,
  ): Promise<ForwardMessageResultDto> {
    try {
      const response = await this.messagesApi.forwardMessage(
        { xUserId: userId, forwardMessageDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('forwardMessage', error);
    }
  }
}
