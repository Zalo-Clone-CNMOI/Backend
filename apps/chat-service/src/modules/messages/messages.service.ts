import { Injectable, Logger } from '@nestjs/common';
import { MessageRepository } from '@libs/scylla';
import type {
  PersistedMessage,
  MessageAttachment,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from '@app/types/interfaces/chat.interface';
import {
  GetMessagesQueryDto,
  MessageResponseDto,
  MessageListResponseDto,
  AttachmentResponseDto,
  MessageReactionsResponseDto,
  MessageReactionDto,
  ReactionSummaryDto,
} from './dto';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly cdnBaseUrl: string;

  constructor(private readonly messageRepository: MessageRepository) {
    this.cdnBaseUrl =
      process.env.CDN_BASE_URL ??
      process.env.S3_ENDPOINT ??
      'https://cdn.example.com';
  }

  async getMessages(
    conversationId: string,
    query: GetMessagesQueryDto,
  ): Promise<MessageListResponseDto> {
    const options: CursorPaginationOptions = {
      cursor: query.cursor,
      limit: query.limit ?? 50,
    };

    const result: CursorPaginatedResult<PersistedMessage> =
      await this.messageRepository.getMessages(conversationId, options);

    const items = result.items.map((msg) => this.toMessageResponse(msg));

    return {
      items,
      nextCursor: result.next_cursor,
      hasMore: result.has_more,
    };
  }

  async getMessage(
    conversationId: string,
    createdAt: number,
    messageId: string,
  ): Promise<MessageResponseDto | null> {
    const message = await this.messageRepository.getMessage(
      conversationId,
      createdAt,
      messageId,
    );

    if (!message) return null;

    return this.toMessageResponse(message);
  }

  async getMessageReactions(
    messageId: string,
  ): Promise<MessageReactionsResponseDto> {
    const reactions = await this.messageRepository.getReactions(messageId);

    const reactionDtos: MessageReactionDto[] = reactions.map((r) => ({
      userId: r.user_id,
      reactionType: r.reaction_type,
      createdAt: r.created_at,
    }));

    const summaryMap = new Map<string, { count: number; userIds: string[] }>();
    for (const r of reactions) {
      const existing = summaryMap.get(r.reaction_type) ?? {
        count: 0,
        userIds: [],
      };
      existing.count++;
      existing.userIds.push(r.user_id);
      summaryMap.set(r.reaction_type, existing);
    }

    const summary: ReactionSummaryDto[] = Array.from(summaryMap.entries()).map(
      ([type, data]) => ({
        type,
        count: data.count,
        userIds: data.userIds,
      }),
    );

    return {
      messageId,
      reactions: reactionDtos,
      summary,
    };
  }

  private toMessageResponse(message: PersistedMessage): MessageResponseDto {
    return {
      messageId: message.message_id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      body: message.deleted_at ? '' : message.body,
      createdAt: message.created_at,
      attachments: message.attachments?.map((a) =>
        this.toAttachmentResponse(a),
      ),
      replyToMessageId: message.reply_to_message_id,
      editedAt: message.edited_at,
      deletedAt: message.deleted_at,
      isDeleted: !!message.deleted_at,
    };
  }

  private toAttachmentResponse(
    attachment: MessageAttachment,
  ): AttachmentResponseDto {
    const bucket = process.env.S3_BUCKET ?? 'be-media';

    return {
      key: attachment.key,
      type: attachment.type,
      name: attachment.name,
      size: attachment.size,
      contentType: attachment.content_type,
      thumbnailKey: attachment.thumbnail_key,
      url: this.buildCdnUrl(bucket, attachment.key),
      thumbnailUrl: attachment.thumbnail_key
        ? this.buildCdnUrl(bucket, attachment.thumbnail_key)
        : undefined,
    };
  }

  private buildCdnUrl(bucket: string, key: string): string {
    if (
      this.cdnBaseUrl.includes('localhost') ||
      this.cdnBaseUrl.includes('localstack')
    ) {
      return `${this.cdnBaseUrl}/${bucket}/${key}`;
    }
    return `${this.cdnBaseUrl}/${key}`;
  }
}
