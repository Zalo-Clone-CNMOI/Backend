import { Injectable } from '@nestjs/common';
import { ChatClientService } from '@app/clients';
import type {
  ForwardMessageDto,
  ForwardMessageResultDto,
} from './dto/forward-message.dto';

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

  async getPinnedMessages(
    accessToken: string,
    conversationId: string,
    userId: string,
    limit?: number,
  ) {
    return this.chatClient.getPinnedMessages(
      accessToken,
      conversationId,
      userId,
      limit,
    );
  }

  async pinMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
    userId: string,
  ) {
    return this.chatClient.pinMessage(
      accessToken,
      conversationId,
      createdAt,
      messageId,
      userId,
    );
  }

  async unpinMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
    userId: string,
  ) {
    return this.chatClient.unpinMessage(
      accessToken,
      conversationId,
      createdAt,
      messageId,
      userId,
    );
  }

  async getMessageReactions(accessToken: string, messageId: string) {
    return this.chatClient.getMessageReactions(accessToken, messageId);
  }

  async searchMessages(
    accessToken: string,
    conversationId: string,
    q?: string,
    senderId?: string,
    from?: number,
    to?: number,
    fileType?: 'images' | 'video' | 'files',
  ) {
    return this.chatClient.searchMessages(
      accessToken,
      conversationId,
      q,
      senderId,
      from,
      to,
      fileType,
    );
  }

  async forwardMessage(
    dto: ForwardMessageDto,
    accessToken: string,
    userId: string,
  ): Promise<ForwardMessageResultDto> {
    const client: Pick<ChatClientService, 'forwardMessage'> = this.chatClient;
    const payload = {
      forward_id: dto.forward_id,
      source_message_id: dto.source_message_id,
      targets: dto.targets.map((target) => ({
        message_id: target.message_id,
        conversation_id: target.conversation_id,
      })),
    };
    return (await client.forwardMessage(
      accessToken,
      payload,
      userId,
    )) as ForwardMessageResultDto;
  }
}
