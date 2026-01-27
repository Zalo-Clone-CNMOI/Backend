import { Injectable } from '@nestjs/common';
import { ChatClientService } from '@app/clients';

@Injectable()
export class MessagesService {
  constructor(private readonly chatClient: ChatClientService) {}

  async getMessages(
    accessToken: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ) {
    return this.chatClient.getMessages(
      accessToken,
      conversationId,
      cursor,
      limit,
    );
  }

  async getMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
  ) {
    return this.chatClient.getMessage(
      accessToken,
      conversationId,
      createdAt,
      messageId,
    );
  }

  async getMessageReactions(accessToken: string, messageId: string) {
    return this.chatClient.getMessageReactions(accessToken, messageId);
  }
}
