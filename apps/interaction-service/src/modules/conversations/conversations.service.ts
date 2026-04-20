import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, MoreThan, QueryFailedError } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  NotificationOutboxPublisher,
  type NotificationOutboxPublishResult,
} from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  type NotificationRequestedEvent,
  NotificationType,
  KafkaTopics,
  type ConversationCreatedEvent,
  type ConversationDisbandedEvent,
  type ConversationMemberAddedEvent,
  type ConversationMemberRemovedEvent,
  type ConversationMemberRoleUpdatedEvent,
  type ConversationUpdatedEvent,
  type GroupInviteAcceptedEvent,
  type GroupInviteCancelledEvent,
  type GroupInviteExpiredEvent,
  type GroupInviteRejectedEvent,
  type GroupInviteSentEvent,
} from '@libs/contracts';

import {
  User,
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import {
  ErrorCode,
  ConversationType,
  GroupInviteStatus,
  UpdateMemberRoleDtoRoleEnum,
  UserStatus,
} from '@app/constant';
import {
  BusinessException,
  PaginatedResponse,
  PaginationMeta,
  PaginationQuery,
} from '@app/types';
import { CacheService, REDIS_CLIENT } from '@libs/redis';

import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  GetGroupInvitesQueryDto,
  GroupInviteItemDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  ConversationListItemDto,
  ConversationDetailDto,
  ConversationMemberResponseDto,
} from './dto';
import { RedisClientType } from 'redis';

interface LastMessage {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  has_attachments: boolean;
  message_type?:
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'mixed'
    | 'deleted'
    | 'unknown';
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    @InjectRepository(ConversationInvite)
    private readonly inviteRepository: Repository<ConversationInvite>,
    private readonly cacheService: CacheService,
    private readonly notificationPublisher: NotificationOutboxPublisher,
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  /**
   * Get conversations for user
   */
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
          type: this.resolveLastMessageType(lastMessageRaw),
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

      const base = this.toListItem(c, userId, myMembership);

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
  /**
   * Get conversation by ID
   */
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

    const detail = this.toDetailResponse(conversation, myMembership);

    await this.cacheService.setConversationDetail(conversationId, detail);

    return detail;
  }

  /**
   * Create group conversation
   */
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

    await this.enqueueNotifications(
      createdNotifications,
      `group_created:${savedConversation.id}`,
    );

    // Reload with relations
    return this.getConversationById(userId, savedConversation.id);
  }

  /**
   * Create or get direct conversation
   */
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

  /**
   * Update conversation (group only)
   */
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

    if (myMembership.role === UpdateMemberRoleDtoRoleEnum.MEMBER) {
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

  /**
   * Add members to group
   */
  async addMembers(
    userId: string,
    conversationId: string,
    dto: AddMembersDto,
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

    if (myMembership.role === UpdateMemberRoleDtoRoleEnum.MEMBER) {
      throw BusinessException.forbidden(
        ErrorCode.CONVERSATION_PERMISSION_DENIED,
      );
    }

    const newUserIds = dto.memberIds.filter(
      (id) =>
        !conversation.members.some((m) => m.userId === id && m.leftAt === null),
    );

    if (newUserIds.length === 0) {
      throw BusinessException.conflict(ErrorCode.CONVERSATION_ALREADY_MEMBER);
    }

    const users = await this.userRepository.find({
      where: { id: In(newUserIds), status: UserStatus.ACTIVE },
    });

    if (users.length !== newUserIds.length) {
      throw BusinessException.badRequest(ErrorCode.USER_NOT_FOUND);
    }

    const newMembers = newUserIds.map((memberId) =>
      this.memberRepository.create({
        conversationId,
        userId: memberId,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );

    await this.memberRepository.save(newMembers);

    this.logger.log(
      `Members added to conversation ${conversationId}: ${newUserIds.join(', ')}`,
    );

    const usersById = new Map(users.map((user) => [user.id, user]));
    const addedEvent: ConversationMemberAddedEvent = {
      conversation_id: conversationId,
      added_by: userId,
      members: newUserIds.map((memberId) => ({
        user_id: memberId,
        full_name: usersById.get(memberId)?.fullName ?? 'Unknown',
        avatar_url: usersById.get(memberId)?.avatarUrl ?? null,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      })),
      added_at: Date.now(),
      trace_id: `conversation-member-added:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationMemberAdded, addedEvent);

    // Emit notifications to newly added members
    const adderUser = await this.userRepository.findOne({
      where: { id: userId },
      select: ['fullName'],
    });

    const addedMemberNotifications = newUserIds.map((newUserId) => ({
      channel: 'push' as const,
      user_id: newUserId,
      title: 'Added to group',
      body: `${adderUser?.fullName || 'Someone'} added you to ${conversation.name || 'a group'}`,
      type: NotificationType.System,
      data: {
        conversation_id: conversationId,
        added_by: userId,
      },
      rich: {
        image_url: conversation.avatarUrl || undefined,
        priority: 'normal' as const,
        category: 'group_invite',
        thread_id: conversationId,
      },
      requested_at: Date.now(),
    }));

    await this.enqueueNotifications(
      addedMemberNotifications,
      `member_added:${conversationId}`,
    );

    const allMemberIds = [
      ...conversation.members
        .filter((m) => m.leftAt === null)
        .map((m) => m.userId),
      ...newUserIds,
    ];
    await this.cacheService.invalidateConversation(
      conversationId,
      allMemberIds,
    );

    return this.getConversationById(userId, conversationId);
  }

  /**
   * Remove member from group
   */
  async removeMember(
    userId: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ message: string }> {
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

    const targetMembership = conversation.members.find(
      (m) => m.userId === memberId && m.leftAt === null,
    );

    if (!targetMembership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_MEMBER_NOT_FOUND);
    }

    if (userId !== memberId) {
      if (myMembership.role === UpdateMemberRoleDtoRoleEnum.MEMBER) {
        throw BusinessException.forbidden(
          ErrorCode.CONVERSATION_PERMISSION_DENIED,
        );
      }

      if (targetMembership.role === UpdateMemberRoleDtoRoleEnum.OWNER) {
        throw BusinessException.forbidden(
          ErrorCode.CONVERSATION_PERMISSION_DENIED,
        );
      }

      if (
        myMembership.role === UpdateMemberRoleDtoRoleEnum.ADMIN &&
        targetMembership.role === UpdateMemberRoleDtoRoleEnum.ADMIN
      ) {
        throw BusinessException.forbidden(
          ErrorCode.CONVERSATION_PERMISSION_DENIED,
        );
      }
    }

    targetMembership.leftAt = new Date();
    await this.memberRepository.save(targetMembership);

    const removedEvent: ConversationMemberRemovedEvent = {
      conversation_id: conversationId,
      removed_by: userId,
      removed_user_id: memberId,
      removed_at: Date.now(),
      trace_id: `conversation-member-removed:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationMemberRemoved, removedEvent);

    this.logger.log(
      `Member ${memberId} removed from conversation ${conversationId}`,
    );
    const affectedUserIds = conversation.members
      .filter((m) => m.leftAt === null || m.userId === memberId)
      .map((m) => m.userId);
    await this.cacheService.invalidateConversation(
      conversationId,
      affectedUserIds,
    );
    return { message: 'Member removed successfully' };
  }

  /**
   * Leave conversation
   */
  async leaveConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['members'],
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

    if (conversation.type === ConversationType.DIRECT) {
      throw BusinessException.badRequest(ErrorCode.CONVERSATION_CANNOT_LEAVE);
    }

    const activeMembers = conversation.members.filter((m) => m.leftAt === null);

    if (
      myMembership.role === UpdateMemberRoleDtoRoleEnum.OWNER &&
      activeMembers.length > 1
    ) {
      const newOwner =
        activeMembers.find(
          (m) =>
            m.userId !== userId && m.role === UpdateMemberRoleDtoRoleEnum.ADMIN,
        ) || activeMembers.find((m) => m.userId !== userId);

      if (newOwner) {
        const previousRole = newOwner.role;
        newOwner.role = UpdateMemberRoleDtoRoleEnum.OWNER;
        await this.memberRepository.save(newOwner);

        const ownerTransferredEvent: ConversationMemberRoleUpdatedEvent = {
          conversation_id: conversationId,
          updated_by: userId,
          user_id: newOwner.userId,
          previous_role: previousRole,
          current_role: UpdateMemberRoleDtoRoleEnum.OWNER,
          updated_at: Date.now(),
          trace_id: `conversation-owner-transferred:${conversationId}`,
        };
        this.kafkaClient.emit(
          KafkaTopics.ConversationMemberRoleUpdated,
          ownerTransferredEvent,
        );
      }
    }

    // Leave
    myMembership.leftAt = new Date();
    await this.memberRepository.save(myMembership);

    const removedEvent: ConversationMemberRemovedEvent = {
      conversation_id: conversationId,
      removed_by: userId,
      removed_user_id: userId,
      removed_at: Date.now(),
      trace_id: `conversation-member-left:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationMemberRemoved, removedEvent);

    this.logger.log(`User ${userId} left conversation ${conversationId}`);
    await this.cacheService.invalidateConversationList(userId);
    await this.cacheService.invalidateConversation(conversationId);
    return { message: 'Left conversation successfully' };
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    userId: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
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

    if (
      !myMembership ||
      myMembership.role !== UpdateMemberRoleDtoRoleEnum.OWNER
    ) {
      throw BusinessException.forbidden(
        ErrorCode.CONVERSATION_PERMISSION_DENIED,
      );
    }

    const targetMembership = conversation.members.find(
      (m) => m.userId === memberId && m.leftAt === null,
    );

    if (!targetMembership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_MEMBER_NOT_FOUND);
    }

    if (memberId === userId) {
      throw BusinessException.badRequest(ErrorCode.BAD_REQUEST);
    }

    const previousRole = targetMembership.role;
    targetMembership.role = dto.role;
    await this.memberRepository.save(targetMembership);

    const roleUpdatedEvent: ConversationMemberRoleUpdatedEvent = {
      conversation_id: conversationId,
      updated_by: userId,
      user_id: memberId,
      previous_role: previousRole,
      current_role: dto.role,
      updated_at: Date.now(),
      trace_id: `conversation-member-role-updated:${conversationId}`,
    };
    this.kafkaClient.emit(
      KafkaTopics.ConversationMemberRoleUpdated,
      roleUpdatedEvent,
    );

    this.logger.log(
      `Member ${memberId} role updated to ${dto.role} in conversation ${conversationId}`,
    );

    return { message: 'Member role updated successfully' };
  }

  /**
   * Update my settings in conversation
   */
  async updateMySettings(
    userId: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (!membership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    if (dto.nickname !== undefined) membership.nickname = dto.nickname;
    if (dto.isMuted !== undefined) membership.isMuted = dto.isMuted;

    await this.memberRepository.save(membership);

    return { message: 'Settings updated successfully' };
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const readAt = new Date();

    const updateResult = await this.memberRepository
      .createQueryBuilder()
      .update(ConversationMember)
      .set({ lastReadAt: readAt })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('left_at IS NULL')
      .andWhere('(last_read_at IS NULL OR last_read_at < :readAt)', { readAt })
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      const membership = await this.memberRepository.findOne({
        where: { conversationId, userId, leftAt: IsNull() },
      });

      if (!membership) {
        throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
      }
    }

    await this.redis.del(`conversation:unread:${userId}:${conversationId}`);

    return { message: 'Marked as read' };
  }

  /**
   * Disband group conversation (owner only)
   */
  async disbandConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const { activeMemberIds, cancelledInvites, disbandAt, conversationName } =
      await this.inviteRepository.manager.transaction(async (manager) => {
        const conversationRepository = manager.getRepository(Conversation);
        const memberRepository = manager.getRepository(ConversationMember);
        const inviteRepository = manager.getRepository(ConversationInvite);

        const conversation = await conversationRepository
          .createQueryBuilder('conversation')
          .setLock('pessimistic_write')
          .where('conversation.id = :conversationId', { conversationId })
          .getOne();

        if (!conversation) {
          throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
        }

        if (conversation.type !== ConversationType.GROUP) {
          throw BusinessException.badRequest(
            ErrorCode.CONVERSATION_INVALID_TYPE,
          );
        }

        const myMembership = await memberRepository.findOne({
          where: {
            conversationId,
            userId,
            leftAt: IsNull(),
          },
        });

        if (
          !myMembership ||
          myMembership.role !== UpdateMemberRoleDtoRoleEnum.OWNER
        ) {
          throw BusinessException.forbidden(
            ErrorCode.CONVERSATION_PERMISSION_DENIED,
          );
        }

        const disbandAt = new Date();

        conversation.createdById = null;
        await conversationRepository.save(conversation);

        const activeMembers = await memberRepository.find({
          where: {
            conversationId,
            leftAt: IsNull(),
          },
        });
        for (const member of activeMembers) {
          member.leftAt = disbandAt;
        }
        if (activeMembers.length > 0) {
          await memberRepository.save(activeMembers);
        }

        const pendingInvites = await inviteRepository.find({
          where: {
            conversationId,
            status: GroupInviteStatus.PENDING,
          },
        });

        const cancelledInvites: Array<{
          id: string;
          conversationId: string;
          inviterUserId: string;
          invitedUserId: string;
        }> = [];
        for (const invite of pendingInvites) {
          const updateResult = await inviteRepository.update(
            { id: invite.id, status: GroupInviteStatus.PENDING },
            { status: GroupInviteStatus.CANCELLED, respondedAt: disbandAt },
          );
          if ((updateResult.affected ?? 0) === 1) {
            cancelledInvites.push({
              id: invite.id,
              conversationId: invite.conversationId,
              inviterUserId: invite.inviterUserId,
              invitedUserId: invite.invitedUserId,
            });
          }
        }

        return {
          activeMemberIds: activeMembers.map((member) => member.userId),
          cancelledInvites,
          disbandAt,
          conversationName: conversation.name,
        };
      });

    for (const invite of cancelledInvites) {
      const cancelledEvent: GroupInviteCancelledEvent = {
        invite_id: invite.id,
        conversation_id: invite.conversationId,
        inviter_id: invite.inviterUserId,
        invited_user_id: invite.invitedUserId,
        status: 'cancelled',
        cancelled_at: disbandAt.getTime(),
        trace_id: `group-invite-cancelled:${invite.id}`,
      };
      this.kafkaClient.emit(KafkaTopics.GroupInviteCancelled, cancelledEvent);
    }

    const disbandedEvent: ConversationDisbandedEvent = {
      conversation_id: conversationId,
      disbanded_by: userId,
      member_ids: activeMemberIds,
      disbanded_at: disbandAt.getTime(),
      trace_id: `conversation-disbanded:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationDisbanded, disbandedEvent);

    const disbander = await this.userRepository.findOne({
      where: { id: userId },
      select: ['fullName'],
    });

    const disbandNotifications = activeMemberIds
      .filter((memberId) => memberId !== userId)
      .map((memberId) => ({
        channel: 'push' as const,
        user_id: memberId,
        title: 'Group disbanded',
        body: `${disbander?.fullName || 'Group owner'} disbanded ${conversationName || 'the group'}`,
        type: NotificationType.System,
        data: {
          conversation_id: conversationId,
          disbanded_by: userId,
          action: 'group_disbanded',
        },
        rich: {
          priority: 'normal' as const,
          category: 'group_disbanded',
          thread_id: conversationId,
        },
        requested_at: Date.now(),
        trace_id: `group-disbanded-notification:${conversationId}:${memberId}`,
      }));

    await this.enqueueNotifications(
      disbandNotifications,
      `group_disbanded:${conversationId}`,
    );

    await this.cacheService.invalidateConversation(
      conversationId,
      activeMemberIds,
    );
    await Promise.all(
      activeMemberIds.map((memberId) =>
        this.cacheService.invalidateConversationList(memberId),
      ),
    );

    return { message: 'Conversation disbanded successfully' };
  }

  /**
   * Send invites to group conversation members
   */
  async sendGroupInvites(
    userId: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    const txResult = await this.inviteRepository.manager.transaction(
      async (manager) => {
        const conversationRepository = manager.getRepository(Conversation);
        const memberRepository = manager.getRepository(ConversationMember);
        const userRepository = manager.getRepository(User);
        const inviteRepository = manager.getRepository(ConversationInvite);

        const conversation = await conversationRepository
          .createQueryBuilder('conversation')
          .setLock('pessimistic_write')
          .where('conversation.id = :conversationId', { conversationId })
          .getOne();

        if (!conversation) {
          throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
        }

        if (conversation.type !== ConversationType.GROUP) {
          throw BusinessException.badRequest(
            ErrorCode.CONVERSATION_INVALID_TYPE,
          );
        }

        if (!conversation.createdById) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        const myMembership = await memberRepository.findOne({
          where: {
            conversationId,
            userId,
            leftAt: IsNull(),
          },
        });

        if (
          !myMembership ||
          myMembership.role === UpdateMemberRoleDtoRoleEnum.MEMBER
        ) {
          throw BusinessException.forbidden(
            ErrorCode.CONVERSATION_PERMISSION_DENIED,
          );
        }

        const activeMembers = await memberRepository.find({
          where: {
            conversationId,
            leftAt: IsNull(),
          },
        });
        const activeMemberIds = new Set(activeMembers.map((m) => m.userId));

        const requestedUserIds = [...new Set(dto.userIds)].filter(
          (candidateId) => !activeMemberIds.has(candidateId),
        );

        if (requestedUserIds.length === 0) {
          return {
            conversationName: conversation.name,
            expiredInvites: [] as Array<{
              id: string;
              conversationId: string;
              inviterUserId: string;
              invitedUserId: string;
              expiredAt: number;
            }>,
            savedInvites: [] as ConversationInvite[],
          };
        }

        const users = await userRepository.find({
          where: { id: In(requestedUserIds), status: UserStatus.ACTIVE },
        });
        const validUserIds = new Set(users.map((user) => user.id));

        const nowDate = new Date();
        const stalePendingInvites = await inviteRepository.find({
          where: {
            conversationId,
            status: GroupInviteStatus.PENDING,
            invitedUserId: In(requestedUserIds),
          },
        });
        const expiredInvites: Array<{
          id: string;
          conversationId: string;
          inviterUserId: string;
          invitedUserId: string;
          expiredAt: number;
        }> = [];

        for (const invite of stalePendingInvites) {
          if (invite.expiresAt.getTime() > nowDate.getTime()) {
            continue;
          }

          const updateResult = await inviteRepository.update(
            { id: invite.id, status: GroupInviteStatus.PENDING },
            { status: GroupInviteStatus.EXPIRED, respondedAt: nowDate },
          );
          if ((updateResult.affected ?? 0) === 1) {
            expiredInvites.push({
              id: invite.id,
              conversationId: invite.conversationId,
              inviterUserId: invite.inviterUserId,
              invitedUserId: invite.invitedUserId,
              expiredAt: nowDate.getTime(),
            });
          }
        }

        const pendingInvites = await inviteRepository.find({
          where: {
            conversationId,
            status: GroupInviteStatus.PENDING,
            invitedUserId: In(requestedUserIds),
          },
        });
        const pendingInviteUserIds = new Set(
          pendingInvites.map((invite) => invite.invitedUserId),
        );

        const expiresAt = new Date(
          nowDate.getTime() + (dto.expiresInHours ?? 168) * 60 * 60 * 1000,
        );
        const creatableInviteUserIds = requestedUserIds.filter(
          (candidateId) =>
            validUserIds.has(candidateId) &&
            !pendingInviteUserIds.has(candidateId),
        );

        if (creatableInviteUserIds.length === 0) {
          return {
            conversationName: conversation.name,
            expiredInvites,
            savedInvites: [] as ConversationInvite[],
          };
        }

        const invites = creatableInviteUserIds.map((invitedUserId) =>
          inviteRepository.create({
            conversationId,
            inviterUserId: userId,
            invitedUserId,
            status: GroupInviteStatus.PENDING,
            message: dto.message ?? null,
            expiresAt,
            respondedAt: null,
          }),
        );

        let savedInvites: ConversationInvite[] = [];
        try {
          savedInvites = await inviteRepository.save(invites);
        } catch (error) {
          if (
            error instanceof QueryFailedError &&
            (error as QueryFailedError & { driverError?: { code?: string } })
              .driverError?.code === '23505'
          ) {
            throw BusinessException.conflict(
              ErrorCode.GROUP_INVITE_ALREADY_EXISTS,
            );
          }
          throw error;
        }

        return {
          conversationName: conversation.name,
          expiredInvites,
          savedInvites,
        };
      },
    );

    for (const expiredInvite of txResult.expiredInvites) {
      const expiredEvent: GroupInviteExpiredEvent = {
        invite_id: expiredInvite.id,
        conversation_id: expiredInvite.conversationId,
        inviter_id: expiredInvite.inviterUserId,
        invited_user_id: expiredInvite.invitedUserId,
        status: 'expired',
        expired_at: expiredInvite.expiredAt,
        trace_id: `group-invite-expired:${expiredInvite.id}`,
      };
      this.kafkaClient.emit(KafkaTopics.GroupInviteExpired, expiredEvent);
    }

    const inviter = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'fullName', 'avatarUrl'],
    });

    const inviteNotifications: NotificationRequestedEvent[] = [];

    for (const invite of txResult.savedInvites) {
      const sentEvent: GroupInviteSentEvent = {
        invite_id: invite.id,
        conversation_id: conversationId,
        inviter_id: userId,
        invited_user_id: invite.invitedUserId,
        inviter_full_name: inviter?.fullName ?? 'Unknown',
        conversation_name: txResult.conversationName,
        message: invite.message,
        expires_at: invite.expiresAt.getTime(),
        sent_at: invite.createdAt.getTime(),
        trace_id: `group-invite-sent:${invite.id}`,
      };
      this.kafkaClient.emit(KafkaTopics.GroupInviteSent, sentEvent);

      const notification: NotificationRequestedEvent = {
        channel: 'push',
        user_id: invite.invitedUserId,
        title: 'Group invite',
        body: `${inviter?.fullName || 'Someone'} invited you to ${txResult.conversationName || 'a group'}`,
        type: NotificationType.GroupInvite,
        data: {
          invite_id: invite.id,
          conversation_id: conversationId,
        },
        rich: {
          image_url: inviter?.avatarUrl || undefined,
          priority: 'normal',
          category: 'group_invite',
          thread_id: conversationId,
        },
        requested_at: Date.now(),
        trace_id: `group-invite-sent:${invite.id}`,
      };
      inviteNotifications.push(notification);
    }
    await this.enqueueNotifications(
      inviteNotifications,
      `group_invite_sent:${conversationId}`,
    );

    return {
      acceptedCount: txResult.savedInvites.length,
      skippedCount: dto.userIds.length - txResult.savedInvites.length,
      inviteIds: txResult.savedInvites.map((invite) => invite.id),
    };
  }

  /**
   * Get pending invites for current user
   */
  async getPendingGroupInvites(
    userId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;
    const status = query.status ?? GroupInviteStatus.PENDING;
    const now = new Date();

    let invites: ConversationInvite[] = [];
    let total = 0;

    if (status === GroupInviteStatus.EXPIRED) {
      [invites, total] = await this.inviteRepository
        .createQueryBuilder('invite')
        .where('invite.invitedUserId = :userId', { userId })
        .andWhere(
          '(invite.status = :expired OR (invite.status = :pending AND invite.expiresAt <= :now))',
          {
            expired: GroupInviteStatus.EXPIRED,
            pending: GroupInviteStatus.PENDING,
            now,
          },
        )
        .orderBy('invite.createdAt', 'DESC')
        .skip(offset)
        .take(limit)
        .getManyAndCount();
    } else {
      const where =
        status === GroupInviteStatus.PENDING
          ? { invitedUserId: userId, status, expiresAt: MoreThan(now) }
          : { invitedUserId: userId, status };

      [invites, total] = await this.inviteRepository.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: offset,
        take: limit,
      });
    }

    const items = invites.map((invite) => this.toGroupInviteItem(invite));

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

  /**
   * Get invites for a group conversation (admin/owner)
   */
  async getConversationInvites(
    userId: string,
    conversationId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (!membership) {
      throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    if (membership.role === UpdateMemberRoleDtoRoleEnum.MEMBER) {
      throw BusinessException.forbidden(
        ErrorCode.CONVERSATION_PERMISSION_DENIED,
      );
    }

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const now = new Date();

    let invites: ConversationInvite[] = [];
    let total = 0;

    if (query.status === GroupInviteStatus.EXPIRED) {
      [invites, total] = await this.inviteRepository
        .createQueryBuilder('invite')
        .where('invite.conversationId = :conversationId', { conversationId })
        .andWhere(
          '(invite.status = :expired OR (invite.status = :pending AND invite.expiresAt <= :now))',
          {
            expired: GroupInviteStatus.EXPIRED,
            pending: GroupInviteStatus.PENDING,
            now,
          },
        )
        .orderBy('invite.createdAt', 'DESC')
        .skip(offset)
        .take(limit)
        .getManyAndCount();
    } else {
      const where = query.status
        ? query.status === GroupInviteStatus.PENDING
          ? { conversationId, status: query.status, expiresAt: MoreThan(now) }
          : { conversationId, status: query.status }
        : { conversationId };

      [invites, total] = await this.inviteRepository.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: offset,
        take: limit,
      });
    }

    const items = invites.map((invite) => this.toGroupInviteItem(invite));

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

  /**
   * Accept a group invite and join conversation as member
   */
  async acceptGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    const existingInvite = await this.inviteRepository.findOne({
      where: {
        id: inviteId,
        conversationId,
        invitedUserId: userId,
      },
    });

    if (!existingInvite) {
      throw BusinessException.notFound(ErrorCode.GROUP_INVITE_NOT_FOUND);
    }

    const expired = await this.expireInviteIfNeeded(existingInvite);
    if (expired) {
      throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_EXPIRED);
    }

    const accepted = await this.inviteRepository.manager.transaction(
      async (manager) => {
        const inviteRepository = manager.getRepository(ConversationInvite);
        const conversationRepository = manager.getRepository(Conversation);
        const memberRepository = manager.getRepository(ConversationMember);

        const conversation = await conversationRepository
          .createQueryBuilder('conversation')
          .setLock('pessimistic_write')
          .where('conversation.id = :conversationId', { conversationId })
          .getOne();

        if (!conversation || conversation.type !== ConversationType.GROUP) {
          throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
        }

        if (!conversation.createdById) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        const activeOwner = await memberRepository.findOne({
          where: {
            conversationId,
            leftAt: IsNull(),
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
          },
        });
        if (!activeOwner) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        const membership = await memberRepository.findOne({
          where: { conversationId, userId },
        });
        if (membership) {
          membership.leftAt = null;
          membership.role = UpdateMemberRoleDtoRoleEnum.MEMBER;
          await memberRepository.save(membership);
        } else {
          await memberRepository.save(
            memberRepository.create({
              conversationId,
              userId,
              role: UpdateMemberRoleDtoRoleEnum.MEMBER,
            }),
          );
        }

        const respondedAt = new Date();
        const updateResult = await inviteRepository.update(
          { id: existingInvite.id, status: GroupInviteStatus.PENDING },
          { status: GroupInviteStatus.ACCEPTED, respondedAt },
        );
        if ((updateResult.affected ?? 0) !== 1) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        return {
          inviteId: existingInvite.id,
          inviterUserId: existingInvite.inviterUserId,
          respondedAt,
        };
      },
    );

    const acceptedEvent: GroupInviteAcceptedEvent = {
      invite_id: accepted.inviteId,
      conversation_id: conversationId,
      inviter_id: accepted.inviterUserId,
      invited_user_id: userId,
      status: 'accepted',
      responded_at: accepted.respondedAt.getTime(),
      trace_id: `group-invite-accepted:${accepted.inviteId}`,
    };
    this.kafkaClient.emit(KafkaTopics.GroupInviteAccepted, acceptedEvent);

    const acceptedUser = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'fullName', 'avatarUrl'],
    });
    const memberAddedEvent: ConversationMemberAddedEvent = {
      conversation_id: conversationId,
      added_by: accepted.inviterUserId,
      members: [
        {
          user_id: userId,
          full_name: acceptedUser?.fullName ?? 'Unknown',
          avatar_url: acceptedUser?.avatarUrl ?? null,
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        },
      ],
      added_at: Date.now(),
      trace_id: `conversation-member-added:${conversationId}`,
    };
    this.kafkaClient.emit(
      KafkaTopics.ConversationMemberAdded,
      memberAddedEvent,
    );

    await this.cacheService.invalidateConversationList(userId);
    await this.cacheService.invalidateConversation(conversationId);

    return { message: 'Group invite accepted' };
  }

  /**
   * Reject a group invite
   */
  async rejectGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    const invite = await this.inviteRepository.findOne({
      where: {
        id: inviteId,
        conversationId,
        invitedUserId: userId,
      },
    });

    if (!invite) {
      throw BusinessException.notFound(ErrorCode.GROUP_INVITE_NOT_FOUND);
    }

    const expired = await this.expireInviteIfNeeded(invite);
    if (expired) {
      throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_EXPIRED);
    }

    const respondedAt = new Date();
    const updateResult = await this.inviteRepository.update(
      {
        id: invite.id,
        status: GroupInviteStatus.PENDING,
      },
      {
        status: GroupInviteStatus.REJECTED,
        respondedAt,
      },
    );
    if ((updateResult.affected ?? 0) !== 1) {
      throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_INVALID_STATUS);
    }

    const rejectedEvent: GroupInviteRejectedEvent = {
      invite_id: invite.id,
      conversation_id: conversationId,
      inviter_id: invite.inviterUserId,
      invited_user_id: userId,
      status: 'rejected',
      responded_at: respondedAt.getTime(),
      trace_id: `group-invite-rejected:${invite.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.GroupInviteRejected, rejectedEvent);

    return { message: 'Group invite rejected' };
  }

  /**
   * Cancel a pending group invite
   */
  async cancelGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    const invite = await this.inviteRepository.findOne({
      where: {
        id: inviteId,
        conversationId,
      },
    });

    if (!invite) {
      throw BusinessException.notFound(ErrorCode.GROUP_INVITE_NOT_FOUND);
    }

    if (invite.inviterUserId !== userId) {
      const membership = await this.memberRepository.findOne({
        where: {
          conversationId,
          userId,
          leftAt: IsNull(),
        },
      });

      if (
        !membership ||
        membership.role === UpdateMemberRoleDtoRoleEnum.MEMBER
      ) {
        throw BusinessException.forbidden(
          ErrorCode.CONVERSATION_PERMISSION_DENIED,
        );
      }
    }

    const expired = await this.expireInviteIfNeeded(invite);
    if (expired) {
      throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_EXPIRED);
    }

    const respondedAt = new Date();
    const updateResult = await this.inviteRepository.update(
      {
        id: invite.id,
        status: GroupInviteStatus.PENDING,
      },
      {
        status: GroupInviteStatus.CANCELLED,
        respondedAt,
      },
    );
    if ((updateResult.affected ?? 0) !== 1) {
      throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_INVALID_STATUS);
    }

    const cancelledEvent: GroupInviteCancelledEvent = {
      invite_id: invite.id,
      conversation_id: conversationId,
      inviter_id: invite.inviterUserId,
      invited_user_id: invite.invitedUserId,
      status: 'cancelled',
      cancelled_at: respondedAt.getTime(),
      trace_id: `group-invite-cancelled:${invite.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.GroupInviteCancelled, cancelledEvent);

    return { message: 'Group invite cancelled' };
  }

  /**
   * Convert to list item response
   */
  private toListItem(
    conversation: Conversation,
    userId: string,
    myMembership?: ConversationMember,
  ): ConversationListItemDto {
    const activeMembers =
      conversation.members?.filter((m) => m.leftAt === null) ?? [];

    let name = conversation.name;
    let avatarUrl = conversation.avatarUrl;

    if (conversation.type === ConversationType.DIRECT) {
      const otherMember = activeMembers.find((m) => m.userId !== userId);
      if (otherMember?.user) {
        name = otherMember.user.fullName;
        avatarUrl = otherMember.user.avatarUrl;
      }
    }

    return {
      id: conversation.id,
      type: conversation.type as 'direct' | 'group',
      name,
      avatarUrl,
      lastMessage: null, // TODO: Add last message from ScyllaDB
      unreadCount: 0, // TODO: Calculate from lastReadAt
      lastMessageAt: conversation.lastMessageAt,
      isMuted: myMembership?.isMuted ?? false,
      memberCount: activeMembers.length,
      createdAt: conversation.createdAt,
    };
  }

  /**
   * Convert to detail response
   */
  private toDetailResponse(
    conversation: Conversation,
    myMembership: ConversationMember,
  ): ConversationDetailDto {
    const activeMembers =
      conversation.members?.filter((m) => m.leftAt === null) ?? [];

    return {
      id: conversation.id,
      type: conversation.type as 'direct' | 'group',
      name: conversation.name,
      avatarUrl: conversation.avatarUrl,
      createdById: conversation.createdById,
      members: activeMembers.map((m) => this.toMemberResponse(m)),
      mySettings: {
        role: myMembership.role,
        nickname: myMembership.nickname,
        isMuted: myMembership.isMuted,
        lastReadAt: myMembership.lastReadAt,
      },
      createdAt: conversation.createdAt,
    };
  }

  /**
   * Convert to member response
   */
  private toMemberResponse(
    member: ConversationMember,
  ): ConversationMemberResponseDto {
    return {
      id: member.id,
      userId: member.userId,
      fullName: member.user?.fullName ?? 'Unknown',
      avatarUrl: member.user?.avatarUrl ?? null,
      role: member.role,
      nickname: member.nickname,
      joinedAt: member.joinedAt,
    };
  }

  private resolveLastMessageType(
    snapshot: LastMessage,
  ):
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'mixed'
    | 'deleted'
    | 'unknown' {
    if (snapshot.message_type) {
      return snapshot.message_type;
    }

    if (snapshot.has_attachments) {
      return 'unknown';
    }

    return snapshot.body.trim().length > 0 ? 'text' : 'unknown';
  }

  private toGroupInviteItem(invite: ConversationInvite): GroupInviteItemDto {
    const status =
      invite.status === GroupInviteStatus.PENDING &&
      invite.expiresAt.getTime() <= Date.now()
        ? GroupInviteStatus.EXPIRED
        : invite.status;

    return {
      id: invite.id,
      conversationId: invite.conversationId,
      inviterUserId: invite.inviterUserId,
      invitedUserId: invite.invitedUserId,
      status,
      message: invite.message,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      respondedAt: invite.respondedAt,
    };
  }

  private async enqueueNotifications(
    notifications: NotificationRequestedEvent[],
    context: string,
  ): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    const batchSize = 50;

    for (let offset = 0; offset < notifications.length; offset += batchSize) {
      const batch = notifications.slice(offset, offset + batchSize);
      const results = await Promise.allSettled(
        batch.map((notification) =>
          this.notificationPublisher.publish(notification),
        ),
      );

      this.logNotificationPublishRejections(
        results,
        batch.map((notification) => notification.user_id),
        context,
      );
    }
  }

  private logNotificationPublishRejections(
    results: PromiseSettledResult<NotificationOutboxPublishResult>[],
    recipientIds: string[],
    context: string,
  ): void {
    results.forEach((result, index) => {
      if (result.status === 'rejected' || result.value === 'failed') {
        this.logger.error(
          `[NotificationOutbox] failed to enqueue notification context=${context} recipient=${recipientIds[index] ?? 'unknown'}`,
          result.status === 'rejected' ? result.reason : 'publish_failed',
        );
      }
    });
  }

  private async expireInviteIfNeeded(
    invite: ConversationInvite,
  ): Promise<boolean> {
    if (invite.status !== GroupInviteStatus.PENDING) {
      return false;
    }

    if (invite.expiresAt.getTime() > Date.now()) {
      return false;
    }

    const respondedAt = new Date();
    const updateResult = await this.inviteRepository.update(
      { id: invite.id, status: GroupInviteStatus.PENDING },
      { status: GroupInviteStatus.EXPIRED, respondedAt },
    );
    if ((updateResult.affected ?? 0) !== 1) {
      const latestInvite = await this.inviteRepository.findOne({
        where: { id: invite.id },
      });
      return latestInvite?.status === GroupInviteStatus.EXPIRED;
    }

    const expiredEvent: GroupInviteExpiredEvent = {
      invite_id: invite.id,
      conversation_id: invite.conversationId,
      inviter_id: invite.inviterUserId,
      invited_user_id: invite.invitedUserId,
      status: 'expired',
      expired_at: respondedAt.getTime(),
      trace_id: `group-invite-expired:${invite.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.GroupInviteExpired, expiredEvent);

    return true;
  }
}
