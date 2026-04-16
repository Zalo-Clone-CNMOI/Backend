import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ClientKafka } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { KAFKA_CLIENT } from '@libs/kafka';
import { User } from '@libs/database';
import { ConversationMembershipService } from '@libs/mvp-access';
import { inferMediaVisibility } from '@app/constant';
import { MediaClientService } from '@app/clients';
import { KafkaTopics } from '@libs/contracts';
import type { ForwardedFrom, ChatMessageForwardCommand } from '@libs/contracts';
import type {
  PersistedMessage,
  MessageAttachment,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from '@app/types/interfaces/chat.interface';
import {
  ForwardMessageDto,
  ForwardMessageResultDto,
  ForwardTargetResultDto,
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

interface AttachmentItem {
  key: string;
  type: string;
  name: string;
  size: number;
  contentType: string;
  thumbnailKey?: string | null;
}

function deriveSourceType(
  body: string | null | undefined,
  attachments: AttachmentItem[] | undefined,
): 'text' | 'image' | 'file' | 'mixed' {
  const hasText = !!body?.trim();
  const atts = attachments ?? [];
  if (atts.length === 0) return 'text';
  const types = new Set(atts.map((a) => a.type));
  if (hasText) return 'mixed';
  if (types.size === 1 && types.has('image')) return 'image';
  if (types.size > 1) return 'mixed';
  return 'file';
}

@Injectable()
export class MessagesService implements OnModuleInit {
  private readonly logger = new Logger(MessagesService.name);
  private readonly cdnBaseUrl: string;

  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly cacheService: CacheService,
    private readonly mediaClient: MediaClientService,
    private readonly membershipService: ConversationMembershipService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
  ) {
    const bucket = process.env.S3_BUCKET ?? 'onn-bucket-23';
    const region = process.env.AWS_REGION ?? 'ap-southeast-1';
    const endpoint = process.env.S3_ENDPOINT;
    this.cdnBaseUrl = endpoint
      ? endpoint
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  async onModuleInit() {
    await this.kafka.connect();
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

  async getMessageById(messageId: string): Promise<MessageResponseDto | null> {
    const ref = await this.messageRepository.getMessageById(messageId);
    if (!ref) return null;

    const message = await this.messageRepository.getMessage(
      ref.conversation_id,
      ref.created_at,
      messageId,
    );
    if (!message) return null;

    return this.toMessageResponse(message);
  }

  async forwardMessage(
    dto: ForwardMessageDto,
    userId: string,
  ): Promise<ForwardMessageResultDto> {
    const source = await this.getMessageById(dto.source_message_id);
    if (!source) {
      throw new NotFoundException('Source message not found');
    }
    if (source.isDeleted) {
      throw new NotFoundException('Source message has been deleted');
    }

    const canReadSource =
      await this.membershipService.canUserAccessConversation(
        userId,
        source.conversationId,
      );
    if (!canReadSource) {
      throw new ForbiddenException('Cannot access source conversation');
    }

    const senderUser = await this.userRepo.findOne({
      where: { id: source.senderId },
    });
    const senderNameSnapshot = senderUser?.fullName ?? 'Unknown';

    const forwardedFrom: ForwardedFrom = {
      source_message_id: source.messageId,
      source_conversation_id: source.conversationId,
      source_sender_id: source.senderId,
      source_sender_name_snapshot: senderNameSnapshot,
      source_created_at: source.createdAt,
      source_type: deriveSourceType(source.body, source.attachments),
    };

    const results: ForwardTargetResultDto[] = [];

    for (const target of dto.targets) {
      const canSend = await this.membershipService.canUserAccessConversation(
        userId,
        target.conversation_id,
      );
      if (!canSend) {
        results.push({
          message_id: target.message_id,
          conversation_id: target.conversation_id,
          status: 'rejected',
          reason: 'not_member',
        });
        continue;
      }

      try {
        const clonedAttachments = await this.cloneAttachments(
          source.attachments ?? [],
          userId,
          target.conversation_id,
        );

        const cmd: ChatMessageForwardCommand = {
          message_id: target.message_id,
          conversation_id: target.conversation_id,
          sender_id: userId,
          sent_at: Date.now(),
          body: source.body ?? '',
          attachments: clonedAttachments,
          forwarded_from: forwardedFrom,
          forward_id: dto.forward_id,
          trace_id: `bff:${dto.forward_id}:${target.message_id}`,
        };

        await lastValueFrom(
          this.kafka.emit(KafkaTopics.ChatMessageForward, cmd),
        );
        results.push({
          message_id: target.message_id,
          conversation_id: target.conversation_id,
          status: 'accepted',
        });
      } catch {
        results.push({
          message_id: target.message_id,
          conversation_id: target.conversation_id,
          status: 'rejected',
          reason: 'dispatch_error',
        });
      }
    }

    return { forward_id: dto.forward_id, results };
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
      forwardedFrom: message.forwarded_from,
    };
  }

  private async cloneAttachments(
    attachments: AttachmentItem[],
    userId: string,
    conversationId: string,
  ): Promise<MessageAttachment[]> {
    if (attachments.length === 0) return [];

    return Promise.all(
      attachments.map(async (att) => {
        const cloned = await this.mediaClient.cloneAttachment(
          { source_key: att.key, conversation_id: conversationId },
          userId,
        );
        return {
          key: cloned.cloned_key,
          type: att.type as MessageAttachment['type'],
          name: att.name,
          size: att.size,
          content_type: att.contentType,
          thumbnail_key: att.thumbnailKey ?? undefined,
          visibility: cloned.visibility,
        } satisfies MessageAttachment;
      }),
    );
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
