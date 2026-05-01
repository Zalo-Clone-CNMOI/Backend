import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  NotificationType,
  KafkaTopics,
  type ConversationCreatedEvent,
  type ConversationUpdatedEvent,
  type ConversationSettingsUpdatedEvent,
} from '@libs/contracts';

import {
  User,
  Conversation,
  ConversationMember,
} from '@libs/database/entities';
import {
  ErrorCode,
  ConversationType,
  UpdateMemberRoleDtoRoleEnum,
  UserStatus,
  DEFAULT_GROUP_SETTINGS,
  type GroupSettings,
} from '@app/constant';
import {
  BusinessException,
  PaginatedResponse,
  PaginationMeta,
  PaginationQuery,
} from '@app/types';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import { RedisClientType } from 'redis';
import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  UpdateGroupSettingsDto,
  ConversationListItemDto,
  ConversationDetailDto,
} from '../dto';
import {
  toListItem,
  toDetailResponse,
  resolveLastMessageType,
  type LastMessage,
} from '../helper/conversation-mapper';
import { enqueueNotifications } from '../helper/conversations-notification.helper';

@Injectable()
export class ConversationCoreService {
  private readonly logger = new Logger(ConversationCoreService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    private readonly cacheService: CacheService,
    private readonly notificationPublisher: NotificationOutboxPublisher,
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  async getConversations(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<ConversationListItemDto>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const qb = this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.members', 'm', 'm.userId = :userId AND m.leftAt IS NULL', {
        userId,
      })
      .leftJoinAndSelect('c.members', 'members', 'members.leftAt IS NULL')
      .leftJoinAndSelect('members.user', 'memberUser')
      .orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    const myMemberships = await this.memberRepository.find({
      where: {
        userId,
        conversationId: In(conversations.map((c) => c.id)),
        leftAt: IsNull(),
      },
    });

    const membershipMap = new Map(
      myMemberships.map((m) => [m.conversationId, m]),
    );

    const lastMessageKeys = conversations.map(
      (c) => `conversation:last:${c.id}`,
    );

    const unreadKeys = conversations.map(
      (c) => `conversation:unread:${userId}:${c.id}`,
    );

    const [lastMessages, unreadCounts] = await Promise.all([
      this.redis.mGet(lastMessageKeys),
      this.redis.mGet(unreadKeys),
    ]);

    const items = conversations.map((c, index) => {
      const myMembership = membershipMap.get(c.id);

      let lastMessageRaw: LastMessage | null = null;

      try {
        lastMessageRaw = lastMessages[index]
          ? (JSON.parse(lastMessages[index]) as LastMessage)
          : null;
      } catch {
        this.logger.warn(`Invalid Redis JSON for conversation ${c.id}`);
      }

      const memberMap = new Map(
        c.members?.map((m) => [m.userId, m.user?.fullName]),
      );

      let lastMessage: {
        id: string;
        content: string;
        type:
          | 'text'
          | 'image'
          | 'video'
          | 'audio'
          | 'document'
          | 'mixed'
          | 'deleted'
          | 'unknown';
        senderId: string;
        senderName: string;
        createdAt: Date;
      } | null = null;

      if (lastMessageRaw?.message_id) {
        lastMessage = {
          id: lastMessageRaw.message_id,
          content: lastMessageRaw.body,
          type: resolveLastMessageType(lastMessageRaw),
          senderId: lastMessageRaw.sender_id,
          senderName: memberMap.get(lastMessageRaw.sender_id) || 'Unknown',
          createdAt: new Date(lastMessageRaw.created_at),
        };
      } else if (c.lastMessageAt && c.lastMessageId) {
        lastMessage = {
          id: c.lastMessageId,
          content:
            c.type === ConversationType.GROUP
              ? 'New messages'
              : 'No messages yet',
          type: 'unknown',
          senderId: c.lastMessageId,
          senderName: memberMap.get(c.lastMessageId) || 'Unknown',
          createdAt: c.lastMessageAt,
        };
      } else {
        lastMessage = null;
      }

      const unreadCount = Number(unreadCounts[index] || 0);

      const base = toListItem(c, userId, myMembership);

      return {
        ...base,
        lastMessage,
        unreadCount,
      };
    });

    const totalPages = Math.ceil(total / limit);

    const meta: PaginationMeta = {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    return { items, meta };
  }

  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    const cached =
      await this.cacheService.getConversationDetail<ConversationDetailDto>(
        conversationId,
      );
    if (cached) {
      const isMember = await this.memberRepository.findOne({
        where: { conversationId, userId, leftAt: IsNull() },
      });
      if (isMember) {
        this.logger.debug(`Conversation detail cache HIT: ${conversationId}`);
        return cached;
      }
      await this.cacheService.invalidateConversation(conversationId);
    }

    this.logger.debug(`Conversation detail cache MISS: ${conversationId}`);

    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['members', 'members.user'],
    });

    if (!conversation) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
    }

    const myMembership = conversation.members.find(
      (m) => m.userId === userId && m.leftAt === null,
    );

    if (!myMembership) {
      throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const detail = toDetailResponse(conversation, myMembership);

    await this.cacheService.setConversationDetail(conversationId, detail);

    return detail;
  }

  async createGroupConversation(
    userId: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    const memberIds = [...new Set([userId, ...dto.memberIds])];
    const users = await this.userRepository.find({
      where: { id: In(memberIds), status: UserStatus.ACTIVE },
    });

    if (users.length !== memberIds.length) {
      throw BusinessException.badRequest(ErrorCode.USER_NOT_FOUND);
    }

    const conversation = this.conversationRepository.create({
      type: ConversationType.GROUP,
      name: dto.name,
      avatarUrl: dto.avatarUrl ?? null,
      createdById: userId,
    });

    const savedConversation =
      await this.conversationRepository.save(conversation);

    const members = memberIds.map((memberId) =>
      this.memberRepository.create({
        conversationId: savedConversation.id,
        userId: memberId,
        role:
          memberId === userId
            ? UpdateMemberRoleDtoRoleEnum.OWNER
            : UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );

    await this.memberRepository.save(members);

    this.logger.log(
      `Group conversation created: ${savedConversation.id} by ${userId}`,
    );

    const membersById = new Map(users.map((user) => [user.id, user]));
    const createdEvent: ConversationCreatedEvent = {
      conversation_id: savedConversation.id,
      type: ConversationType.GROUP,
      name: savedConversation.name,
      avatar_url: savedConversation.avatarUrl,
      created_by: userId,
      members: memberIds.map((memberId) => ({
        user_id: memberId,
        full_name: membersById.get(memberId)?.fullName ?? 'Unknown',
        avatar_url: membersById.get(memberId)?.avatarUrl ?? null,
        role:
          memberId === userId
            ? UpdateMemberRoleDtoRoleEnum.OWNER
            : UpdateMemberRoleDtoRoleEnum.MEMBER,
      })),
      created_at: savedConversation.createdAt.getTime(),
      trace_id: `conversation-created:${savedConversation.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationCreated, createdEvent);

    const createdNotifications = memberIds
      .filter((memberId) => memberId !== userId)
      .map((memberId) => ({
        channel: 'push' as const,
        user_id: memberId,
        title: 'Added to new group',
        body: `${membersById.get(userId)?.fullName || 'Someone'} created ${savedConversation.name || 'a group'} and added you`,
        type: NotificationType.System,
        data: {
          conversation_id: savedConversation.id,
          created_by: userId,
          action: 'group_created',
        },
        rich: {
          image_url: savedConversation.avatarUrl || undefined,
          priority: 'normal' as const,
          category: 'group_created',
          thread_id: savedConversation.id,
        },
        requested_at: Date.now(),
        trace_id: `group-created-notification:${savedConversation.id}:${memberId}`,
      }));

    await enqueueNotifications(
      createdNotifications,
      `group_created:${savedConversation.id}`,
      this.notificationPublisher,
      this.logger,
    );

    // Reload with relations
    return this.getConversationById(userId, savedConversation.id);
  }

  async createDirectConversation(
    userId: string,
    dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    const { participantId: targetUserId } = dto;

    if (userId === targetUserId) {
      throw BusinessException.badRequest(ErrorCode.BAD_REQUEST);
    }

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId, status: UserStatus.ACTIVE },
    });

    if (!targetUser) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const existingConversation = await this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin(
        'c.members',
        'm1',
        'm1.userId = :userId AND m1.leftAt IS NULL',
        { userId },
      )
      .innerJoin(
        'c.members',
        'm2',
        'm2.userId = :targetUserId AND m2.leftAt IS NULL',
        { targetUserId },
      )
      .where('c.type = :type', { type: ConversationType.DIRECT })
      .getOne();

    if (existingConversation) {
      return this.getConversationById(userId, existingConversation.id);
    }

    const conversation = this.conversationRepository.create({
      type: ConversationType.DIRECT,
      name: null,
      createdById: userId,
      settings: null,
    });

    const savedConversation =
      await this.conversationRepository.save(conversation);

    const members = [userId, targetUserId].map((memberId) =>
      this.memberRepository.create({
        conversationId: savedConversation.id,
        userId: memberId,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );

    await this.memberRepository.save(members);

    this.logger.log(`Direct conversation created: ${savedConversation.id}`);

    return this.getConversationById(userId, savedConversation.id);
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['members'],
    });

    if (!conversation) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw BusinessException.badRequest(ErrorCode.CONVERSATION_INVALID_TYPE);
    }

    const myMembership = conversation.members.find(
      (m) => m.userId === userId && m.leftAt === null,
    );

    if (!myMembership) {
      throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const isPrivileged =
      myMembership.role !== UpdateMemberRoleDtoRoleEnum.MEMBER;
    const changeInfoAllowed =
      isPrivileged || (conversation.settings?.permissions?.change_info ?? true);

    if (!changeInfoAllowed) {
      throw BusinessException.forbidden(
        ErrorCode.CONVERSATION_PERMISSION_DENIED,
      );
    }

    if (dto.name !== undefined) conversation.name = dto.name;
    if (dto.avatarUrl !== undefined) conversation.avatarUrl = dto.avatarUrl;

    await this.conversationRepository.save(conversation);

    this.logger.log(`Conversation updated: ${conversationId} by ${userId}`);

    const updatedEvent: ConversationUpdatedEvent = {
      conversation_id: conversation.id,
      updated_by: userId,
      name: conversation.name,
      avatar_url: conversation.avatarUrl,
      updated_at: Date.now(),
      trace_id: `conversation-updated:${conversation.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationUpdated, updatedEvent);

    const memberIds = conversation.members
      .filter((m) => m.leftAt === null)
      .map((m) => m.userId);
    await this.cacheService.invalidateConversation(conversationId, memberIds);

    return this.getConversationById(userId, conversationId);
  }

  async updateGroupSettings(
    userId: string,
    conversationId: string,
    dto: UpdateGroupSettingsDto,
  ): Promise<ConversationDetailDto> {
    let updatedSettings!: GroupSettings;
    let memberIds!: string[];

    await this.conversationRepository.manager.transaction(async (manager) => {
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId },
        relations: ['members'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!conversation) {
        throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
      }

      if (conversation.type !== ConversationType.GROUP) {
        throw BusinessException.badRequest(ErrorCode.CONVERSATION_INVALID_TYPE);
      }

      const myMembership = conversation.members.find(
        (m) => m.userId === userId && m.leftAt === null,
      );

      if (!myMembership) {
        throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
      }

      if (myMembership.role === UpdateMemberRoleDtoRoleEnum.MEMBER) {
        throw BusinessException.forbidden(
          ErrorCode.CONVERSATION_PERMISSION_DENIED,
        );
      }

      const existing = conversation.settings ?? DEFAULT_GROUP_SETTINGS;
      conversation.settings = {
        permissions: { ...existing.permissions, ...dto.permissions },
        policies: { ...existing.policies, ...dto.policies },
        features: { ...existing.features, ...dto.features },
      };

      await manager.save(Conversation, conversation);

      updatedSettings = conversation.settings;
      memberIds = conversation.members
        .filter((m) => m.leftAt === null)
        .map((m) => m.userId);
    });

    this.logger.log(`Group settings updated: ${conversationId} by ${userId}`);

    const event: ConversationSettingsUpdatedEvent = {
      conversation_id: conversationId,
      updated_by: userId,
      settings: updatedSettings as unknown as Record<string, unknown>,
      updated_at: Date.now(),
      trace_id: `conversation-settings-updated:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationSettingsUpdated, event);

    await this.cacheService.invalidateConversation(conversationId, memberIds);

    return this.getConversationById(userId, conversationId);
  }
}
