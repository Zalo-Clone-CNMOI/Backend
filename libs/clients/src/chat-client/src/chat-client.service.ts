import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { MessagesApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  MessageListResponseDto,
  MessageResponseDto,
  MessageReactionsResponseDto,
  MessageSearchResponseDto,
} from './client/generated';
import type { ChatClientConfig } from './utils/providers';

@Injectable()
export class ChatClientService extends BaseHttpClient {
  protected readonly logger = new Logger(ChatClientService.name);

  constructor(
    private readonly messagesApi: MessagesApi,
    @Inject('CHAT_CLIENT_CONFIG') private readonly config: ChatClientConfig,
    private readonly httpService: HttpService,
  ) {
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

  async getMessageById(
    accessToken: string,
    messageId: string,
  ): Promise<MessageResponseDto | null> {
    try {
      const response =
        await this.httpService.axiosRef.get<MessageResponseDto>(
          `${this.config.baseUrl}/v1/messages/lookup/${messageId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
      return response.data;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        (error as { response?: { status?: number } }).response?.status === 404
      ) {
        return null;
      }
      this.handleError('getMessageById', error);
    }
  }
}
