import { Injectable, Logger } from '@nestjs/common';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { inferMediaVisibility } from '@app/constant';
import type {
  PersistedMessage,
  MessageAttachment,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from '@app/types/interfaces/chat.interface';
import {
  GetMessagesQueryDto,
  SearchMessagesQueryDto,
  MessageResponseDto,
  MessageListResponseDto,
  MessageSearchResponseDto,
  AttachmentResponseDto,
  MessageReactionsResponseDto,
  MessageReactionDto,
  ReactionSummaryDto,
} from './dto';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly cdnBaseUrl: string;

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly cacheService: CacheService,
  ) {
    const bucket = process.env.S3_BUCKET ?? 'onn-bucket-23';
    const region = process.env.AWS_REGION ?? 'ap-southeast-1';
    const endpoint = process.env.S3_ENDPOINT;
    this.cdnBaseUrl = endpoint
      ? endpoint
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  async getMessages(
    conversationId: string,
    query: GetMessagesQueryDto,
  ): Promise<MessageListResponseDto> {
    const isFirstPage = !query.cursor;
    const limit = query.limit ?? 50;

    if (isFirstPage && limit <= 50) {
      const cached =
        await this.cacheService.getRecentMessages<MessageListResponseDto>(
          conversationId,
        );
      if (cached) {
        this.logger.debug(`Recent messages cache HIT: ${conversationId}`);
        return cached;
      }
      this.logger.debug(`Recent messages cache MISS: ${conversationId}`);
    }

    const options: CursorPaginationOptions = {
      cursor: query.cursor,
      limit,
    };

    const result: CursorPaginatedResult<PersistedMessage> =
      await this.messageRepository.getMessages(conversationId, options);

    const items = result.items.map((msg) => this.toMessageResponse(msg));

    const response: MessageListResponseDto = {
      items,
      nextCursor: result.next_cursor,
      hasMore: result.has_more,
    };

    if (isFirstPage && limit <= 50) {
      await this.cacheService.setRecentMessages(conversationId, response);
    }

    return response;
  }

  async searchMessages(
    conversationId: string,
    query: SearchMessagesQueryDto,
  ): Promise<MessageSearchResponseDto> {
    const all = await this.messageRepository.getAllMessages(conversationId);

    const keyword = query.q?.trim().toLowerCase() || undefined;

    const matched = all.filter((msg) => {
      if (msg.deleted_at) return false;
      if (keyword !== undefined && !msg.body.toLowerCase().includes(keyword))
        return false;
      if (query.senderId && msg.sender_id !== query.senderId) return false;
      if (query.from !== undefined && msg.created_at < query.from) return false;
      if (query.to !== undefined && msg.created_at > query.to) return false;
      return true;
    });

    const items = matched.map((msg) => this.toMessageResponse(msg));
    return { items, total: items.length };
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
    const bucket = process.env.S3_BUCKET ?? 'onn-bucket-23';
    const visibility =
      attachment.visibility ?? inferMediaVisibility(attachment.content_type);

    return {
      key: attachment.key,
      type: attachment.type,
      name: attachment.name,
      size: attachment.size,
      contentType: attachment.content_type,
      thumbnailKey: attachment.thumbnail_key,
      visibility,
      url:
        visibility === 'public'
          ? this.buildCdnUrl(bucket, attachment.key)
          : null,
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
