import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { User } from '@libs/database';
import { ConversationMembershipService } from '@libs/mvp-access';
import { KafkaTopics } from '@libs/contracts';
import type { ForwardedFrom, ChatMessageForwardCommand, MessageAttachment } from '@libs/contracts';
import { ChatClientService, MediaClientService } from '@app/clients';
import type { ForwardMessageDto, ForwardMessageResultDto, ForwardTargetResultDto } from './dto/forward-message.dto';

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
  constructor(
    private readonly chatClient: ChatClientService,
    private readonly mediaClient: MediaClientService,
    private readonly membershipService: ConversationMembershipService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async getMessages(
    accessToken: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ) {
    return this.chatClient.getMessages(accessToken, conversationId, cursor, limit);
  }

  async getMessage(
    accessToken: string,
    conversationId: string,
    createdAt: number,
    messageId: string,
  ) {
    return this.chatClient.getMessage(accessToken, conversationId, createdAt, messageId);
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
  ) {
    return this.chatClient.searchMessages(accessToken, conversationId, q, senderId, from, to);
  }

  async forwardMessage(
    dto: ForwardMessageDto,
    accessToken: string,
    userId: string,
  ): Promise<ForwardMessageResultDto> {
    const source = await this.chatClient.getMessageById(accessToken, dto.source_message_id);
    if (!source) {
      throw new NotFoundException('Source message not found');
    }
    if (source.isDeleted) {
      throw new NotFoundException('Source message has been deleted');
    }

    const canReadSource = await this.membershipService.canUserAccessConversation(
      userId,
      source.conversationId,
    );
    if (!canReadSource) {
      throw new ForbiddenException('Cannot access source conversation');
    }

    const senderUser = await this.userRepo.findOne({ where: { id: source.senderId } });
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
      try {
        await lastValueFrom(this.kafka.emit(KafkaTopics.ChatMessageForward, cmd));
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
          reason: 'kafka_error',
        });
      }
    }

    return { forward_id: dto.forward_id, results };
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
}
