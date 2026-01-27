import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';

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
} from '@app/constant';
import {
  BusinessException,
  PaginatedResponse,
  PaginationMeta,
  PaginationQuery,
} from '@app/types';

import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  ConversationListItemDto,
  ConversationDetailDto,
  ConversationMemberResponseDto,
} from './dto';

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

    const items = conversations.map((c) => {
      const myMembership = membershipMap.get(c.id);
      return this.toListItem(c, userId, myMembership);
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

    return this.toDetailResponse(conversation, myMembership);
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

    this.logger.log(
      `Member ${memberId} removed from conversation ${conversationId}`,
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

    // Cannot leave direct conversation
    if (conversation.type === ConversationType.DIRECT) {
      throw BusinessException.badRequest(ErrorCode.CONVERSATION_CANNOT_LEAVE);
    }

    // If owner, need to transfer ownership first (or check if last member)
    const activeMembers = conversation.members.filter((m) => m.leftAt === null);

    if (
      myMembership.role === UpdateMemberRoleDtoRoleEnum.OWNER &&
      activeMembers.length > 1
    ) {
      // Find another admin or longest member to transfer ownership
      const newOwner =
        activeMembers.find(
          (m) =>
            m.userId !== userId && m.role === UpdateMemberRoleDtoRoleEnum.ADMIN,
        ) || activeMembers.find((m) => m.userId !== userId);

      if (newOwner) {
        newOwner.role = UpdateMemberRoleDtoRoleEnum.OWNER;
        await this.memberRepository.save(newOwner);
      }
    }

    // Leave
    myMembership.leftAt = new Date();
    await this.memberRepository.save(myMembership);

    this.logger.log(`User ${userId} left conversation ${conversationId}`);

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

    targetMembership.role = dto.role;
    await this.memberRepository.save(targetMembership);

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
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (!membership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    membership.lastReadAt = new Date();
    await this.memberRepository.save(membership);

    return { message: 'Marked as read' };
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
}
