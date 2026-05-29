import { Injectable, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { KAFKA_CLIENT } from '@libs/kafka';
import { MediaFile, Conversation } from '@libs/database';
import { ConversationMembershipService } from '@libs/mvp-access';
import { RedisService } from '@libs/redis';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { ConversationType } from '@app/constant';
import {
  KafkaTopics,
  WsEvents,
  MENTION_ALL_SENTINEL,
  type WsChatSendPayload,
  type WsChatAckPayload,
  type WsChatEditPayload,
  type WsChatDeletePayload,
  type WsChatReactPayload,
  type WsChatUnreactPayload,
  type WsMessageAttachment,
  type WsMention,
  type MessageMention,
  type ChatMessageSendCommand,
  type ChatMessageEditCommand,
  type ChatMessageDeleteCommand,
  type ChatReactionAddCommand,
  type ChatReactionRemoveCommand,
} from '@libs/contracts';
import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

@Injectable()
export class ChatHandler {
  private readonly AT_ALL_RATE_LIMIT_MAX = 3;
  private readonly AT_ALL_RATE_LIMIT_WINDOW_S = 60;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly membershipService: ConversationMembershipService,
    @InjectRepository(MediaFile)
    private readonly mediaFileRepo: Repository<MediaFile>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handleJoin(socket: AuthedSocket, conversationId: string) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      conversationId,
    );
    if (!canAccess) {
      socket.emit(WsEvents.ChatAck, {
        message_id: '',
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }
    void socket.join(`conv:${conversationId}`);
  }

  async handleSend(socket: AuthedSocket, body: WsChatSendPayload) {
    const userId = String(socket.data.userId);
    const { allowed, reason } = await this.membershipService.canUserSendMessage(
      userId,
      body.conversation_id,
    );
    if (!allowed) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: reason ?? 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const attachmentError = await this.validateAttachments(
      body.attachments,
      userId,
    );
    if (attachmentError) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: attachmentError,
      } satisfies WsChatAckPayload);
      return;
    }

    let normalizedMentions: MessageMention[] | undefined;
    if (body.mentions && body.mentions.length > 0) {
      const result = await this.validateMentions(
        body.mentions,
        body.conversation_id,
        userId,
        body.body,
      );
      if (result.error) {
        socket.emit(WsEvents.ChatAck, {
          message_id: body.message_id,
          status: 'rejected',
          reason: result.error,
        } satisfies WsChatAckPayload);
        return;
      }
      normalizedMentions =
        result.normalized.length > 0 ? result.normalized : undefined;
    }

    const cmd: ChatMessageSendCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      body: body.body,
      sent_at: body.sent_at,
      attachments: body.attachments as ChatMessageSendCommand['attachments'],
      reply_to_message_id: body.reply_to_message_id,
      mentions: normalizedMentions,
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatMessageSend, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  async handleEdit(socket: AuthedSocket, body: WsChatEditPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatMessageEditCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      new_body: body.new_body,
      created_at: body.created_at,
      edited_at: Date.now(),
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatMessageEdit, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  async handleDelete(socket: AuthedSocket, body: WsChatDeletePayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatMessageDeleteCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      created_at: body.created_at,
      deleted_at: Date.now(),
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatMessageDelete, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  async handleReact(socket: AuthedSocket, body: WsChatReactPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatReactionAddCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      reaction_type: body.reaction_type,
      created_at: Date.now(),
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatReactionAdd, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  private async validateMentions(
    mentions: WsMention[],
    conversationId: string,
    senderId: string,
    body: string,
  ): Promise<{ normalized: MessageMention[]; error?: string }> {
    // 1) Bounds check first (cheap, no DB)
    for (const m of mentions) {
      if (m.offset < 0 || m.length <= 0 || m.offset + m.length > body.length) {
        return { normalized: [], error: 'mention_offset_out_of_bounds' };
      }
    }

    // 2) Strip self-mentions and dedupe
    const seen = new Set<string>();
    const filtered: WsMention[] = [];
    for (const m of mentions) {
      if (m.user_id === senderId) continue; // silent self-mention strip
      if (seen.has(m.user_id)) continue; // dedupe
      seen.add(m.user_id);
      filtered.push(m);
    }

    // 3) @all → must be group conversation
    const hasAtAll = filtered.some((m) => m.mention_type === 'all');
    if (hasAtAll) {
      const conv = await this.conversationRepo.findOne({
        where: { id: conversationId },
        select: ['type'],
      });
      if (!conv) {
        return { normalized: [], error: 'conversation_not_found' };
      }
      if (conv.type !== ConversationType.GROUP) {
        return { normalized: [], error: 'at_all_in_direct_chat_disallowed' };
      }
      const rateKey = `at_all:${conversationId}:${senderId}`;
      const count = await this.redisService.incrBy(rateKey, 1);
      if (count === 1) {
        await this.redisService.expire(
          rateKey,
          this.AT_ALL_RATE_LIMIT_WINDOW_S,
        );
      }
      if (count > this.AT_ALL_RATE_LIMIT_MAX) {
        return { normalized: [], error: 'at_all_rate_limited' };
      }
    }

    // 4) Real-user membership check (batch). Zai bot is exempted — it is a
    //    virtual participant that can be @mentioned in any conversation type
    //    without holding a formal ConversationMember row.
    const realUserIds = filtered
      .filter(
        (m) =>
          m.user_id !== MENTION_ALL_SENTINEL &&
          m.mention_type === 'user' &&
          m.user_id !== this.config.zaiBotUserId,
      )
      .map((m) => m.user_id);

    if (realUserIds.length > 0) {
      const memberIds = new Set(
        await this.membershipService.listActiveMemberIds(conversationId),
      );
      for (const id of realUserIds) {
        if (!memberIds.has(id)) {
          return { normalized: [], error: 'mention_target_not_member' };
        }
      }
    }

    // 5) Map to MessageMention shape (fields match)
    const normalized: MessageMention[] = filtered.map((m) => ({
      user_id: m.user_id,
      mention_type: m.mention_type,
      offset: m.offset,
      length: m.length,
    }));

    return { normalized };
  }

  private async validateAttachments(
    attachments: WsMessageAttachment[] | undefined,
    userId: string,
  ): Promise<string | null> {
    if (!attachments || attachments.length === 0) return null;

    const keys = attachments.map((a) => a.key);
    const files = await this.mediaFileRepo.find({
      where: { key: In(keys) },
    });
    const fileMap = new Map(files.map((f) => [f.key, f]));

    for (const att of attachments) {
      const file = fileMap.get(att.key);
      if (!file) return 'attachment_not_found';
      if (!file.uploadedById || file.uploadedById.trim() === '') {
        return 'attachment_not_owned';
      }
      if (file.uploadedById !== userId) return 'attachment_not_owned';
      if (file.status !== 'uploaded') return 'attachment_not_ready';
    }
    return null;
  }

  async handleUnreact(socket: AuthedSocket, body: WsChatUnreactPayload) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatReactionRemoveCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatReactionRemove, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }
}
