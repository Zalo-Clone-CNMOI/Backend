import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Not, QueryFailedError } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  NotificationType,
  KafkaTopics,
  type ConversationMemberAddedEvent,
  type ConversationMemberRemovedEvent,
  type ConversationMemberRoleUpdatedEvent,
  type ConversationDisbandedEvent,
  type GroupInviteCancelledEvent,
  SystemEventType,
  type MemberAddedMetadata,
  type MemberRemovedMetadata,
  type MemberLeftMetadata,
  type OwnerTransferredMetadata,
  type GroupDisbandedMetadata,
  type RoleChangedMetadata,
} from '@libs/contracts';
import { SystemMessageFactory } from '@libs/shared';
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
import { BusinessException } from '@app/types';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import { RedisClientType } from 'redis';
import {
  AddMembersDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  ConversationDetailDto,
} from '../dto';
import { enqueueNotifications } from '../helper/conversations-notification.helper';
import { ConversationCoreService } from './conversation-core.service';

@Injectable()
export class ConversationMemberService {
  private readonly logger = new Logger(ConversationMemberService.name);

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
    private readonly coreService: ConversationCoreService,
  ) {}

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

    const requestedUserIds = [...new Set(dto.memberIds)];
    const activeMemberIds = new Set(
      conversation.members
        .filter((member) => member.leftAt === null)
        .map((member) => member.userId),
    );

    const candidateUserIds = requestedUserIds.filter(
      (id) => !activeMemberIds.has(id),
    );

    if (candidateUserIds.length === 0) {
      throw BusinessException.conflict(ErrorCode.CONVERSATION_ALREADY_MEMBER);
    }

    const users = await this.userRepository.find({
      where: { id: In(candidateUserIds), status: UserStatus.ACTIVE },
    });

    if (users.length !== candidateUserIds.length) {
      throw BusinessException.badRequest(ErrorCode.USER_NOT_FOUND);
    }

    const rejoinableMembershipIds = new Set(
      conversation.members
        .filter((member) => member.leftAt !== null)
        .map((member) => member.userId),
    );

    const revivedCandidateIds: string[] = [];
    const newMemberIds: string[] = [];

    for (const memberId of candidateUserIds) {
      if (rejoinableMembershipIds.has(memberId)) {
        revivedCandidateIds.push(memberId);
        continue;
      }

      newMemberIds.push(memberId);
    }

    const newMembers = newMemberIds.map((memberId) =>
      this.memberRepository.create({
        conversationId,
        userId: memberId,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );

    const revivedMemberIds = await this.memberRepository.manager.transaction(
      async (manager) => {
        const changedRevivedIds: string[] = [];

        for (const revivedMemberId of revivedCandidateIds) {
          const updateResult = await manager.update(
            ConversationMember,
            {
              conversationId,
              userId: revivedMemberId,
              leftAt: Not(IsNull()),
            },
            {
              leftAt: null,
              role: UpdateMemberRoleDtoRoleEnum.MEMBER,
            },
          );

          if ((updateResult.affected ?? 0) > 0) {
            changedRevivedIds.push(revivedMemberId);
          }
        }

        if (newMembers.length > 0) {
          try {
            await manager.save(ConversationMember, newMembers);
          } catch (error) {
            const code =
              error instanceof QueryFailedError
                ? (
                    error as QueryFailedError & {
                      driverError?: { code?: string };
                    }
                  ).driverError?.code
                : undefined;

            if (code !== '23505') {
              throw error;
            }

            throw BusinessException.conflict(
              ErrorCode.CONVERSATION_ALREADY_MEMBER,
            );
          }
        }

        return changedRevivedIds;
      },
    );

    const addedUserIds = [...revivedMemberIds, ...newMemberIds];

    if (addedUserIds.length === 0) {
      throw BusinessException.conflict(ErrorCode.CONVERSATION_ALREADY_MEMBER);
    }

    this.logger.log(
      `Members added to conversation ${conversationId}: ${addedUserIds.join(', ')}`,
    );

    const usersById = new Map(users.map((user) => [user.id, user]));
    const addedEvent: ConversationMemberAddedEvent = {
      conversation_id: conversationId,
      added_by: userId,
      members: addedUserIds.map((memberId) => ({
        user_id: memberId,
        full_name: usersById.get(memberId)?.fullName ?? 'Unknown',
        avatar_url: usersById.get(memberId)?.avatarUrl ?? null,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      })),
      added_at: Date.now(),
      trace_id: `conversation-member-added:${conversationId}`,
    };
    this.kafkaClient.emit(KafkaTopics.ConversationMemberAdded, addedEvent);

    const adderUser = await this.userRepository.findOne({
      where: { id: userId },
      select: ['fullName'],
    });

    const systemMsg = SystemMessageFactory.create({
      conversationId,
      systemEventType: SystemEventType.MEMBER_ADDED,
      metadata: {
        added_by: userId,
        added_by_name: adderUser?.fullName ?? 'Unknown',
        added_members: addedUserIds.map((id) => ({
          user_id: id,
          full_name: usersById.get(id)?.fullName ?? 'Unknown',
        })),
      } satisfies MemberAddedMetadata,
      traceId: `system-msg:member-added:${conversationId}:${Date.now()}`,
      bodyFallback: `${adderUser?.fullName ?? 'Someone'} added members to the group.`,
    });
    this.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);

    const addedMemberNotifications = addedUserIds.map((newUserId) => ({
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

    await enqueueNotifications(
      addedMemberNotifications,
      `member_added:${conversationId}`,
      this.notificationPublisher,
      this.logger,
    );

    const allMemberIds = [
      ...conversation.members
        .filter((m) => m.leftAt === null)
        .map((m) => m.userId),
      ...addedUserIds,
    ];
    await this.cacheService.invalidateConversation(
      conversationId,
      allMemberIds,
    );

    return this.coreService.getConversationById(userId, conversationId);
  }

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

    const removerUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    const removedUser = await this.userRepository.findOne({
      where: { id: memberId },
    });

    const systemMsg = SystemMessageFactory.create({
      conversationId,
      systemEventType: SystemEventType.MEMBER_REMOVED,
      metadata: {
        removed_by: userId,
        removed_by_name: removerUser?.fullName ?? 'Unknown',
        removed_user_id: memberId,
        removed_user_name: removedUser?.fullName ?? 'Unknown',
      } satisfies MemberRemovedMetadata,
      traceId: `system-msg:member-removed:${conversationId}:${Date.now()}`,
      bodyFallback: `${removerUser?.fullName ?? 'Someone'} removed ${removedUser?.fullName ?? 'a member'} from the group.`,
    });
    this.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);

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

        const leavingUser = await this.userRepository.findOne({
          where: { id: userId },
        });
        const newOwnerUser = await this.userRepository.findOne({
          where: { id: newOwner.userId },
        });

        const systemMsgTransfer = SystemMessageFactory.create({
          conversationId,
          systemEventType: SystemEventType.OWNER_TRANSFERRED,
          metadata: {
            previous_owner_id: userId,
            previous_owner_name: leavingUser?.fullName ?? 'Unknown',
            new_owner_id: newOwner.userId,
            new_owner_name: newOwnerUser?.fullName ?? 'Unknown',
          } satisfies OwnerTransferredMetadata,
          traceId: `system-msg:owner-transferred:${conversationId}:${Date.now()}`,
          bodyFallback: `Ownership transferred to ${newOwnerUser?.fullName ?? 'a member'}.`,
        });
        this.kafkaClient.emit(
          KafkaTopics.ChatSystemMessageCreated,
          systemMsgTransfer,
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

    const leavingUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    const systemMsgLeft = SystemMessageFactory.create({
      conversationId,
      systemEventType: SystemEventType.MEMBER_LEFT,
      metadata: {
        user_id: userId,
        user_name: leavingUser?.fullName ?? 'Unknown',
      } satisfies MemberLeftMetadata,
      traceId: `system-msg:member-left:${conversationId}:${Date.now()}`,
      bodyFallback: `${leavingUser?.fullName ?? 'A member'} left the group.`,
    });
    this.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsgLeft);

    this.logger.log(`User ${userId} left conversation ${conversationId}`);
    await this.cacheService.invalidateConversationList(userId);
    await this.cacheService.invalidateConversation(conversationId);
    return { message: 'Left conversation successfully' };
  }

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

    const updaterUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    const targetUser = await this.userRepository.findOne({
      where: { id: memberId },
    });
    const systemMsg = SystemMessageFactory.create({
      conversationId,
      systemEventType: SystemEventType.ROLE_CHANGED,
      metadata: {
        updated_by: userId,
        updated_by_name: updaterUser?.fullName ?? 'Unknown',
        target_user_id: memberId,
        target_user_name: targetUser?.fullName ?? 'Unknown',
        previous_role: previousRole,
        new_role: dto.role,
      } satisfies RoleChangedMetadata,
      traceId: `system-msg:role-changed:${conversationId}:${Date.now()}`,
      bodyFallback: `${updaterUser?.fullName ?? 'Someone'} changed the role of ${targetUser?.fullName ?? 'a member'}.`,
    });
    this.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);

    this.logger.log(
      `Member ${memberId} role updated to ${dto.role} in conversation ${conversationId}`,
    );

    return { message: 'Member role updated successfully' };
  }

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

    const systemMsg = SystemMessageFactory.create({
      conversationId,
      systemEventType: SystemEventType.GROUP_DISBANDED,
      metadata: {
        disbanded_by: userId,
        disbanded_by_name: disbander?.fullName ?? 'Group owner',
      } satisfies GroupDisbandedMetadata,
      traceId: `system-msg:group-disbanded:${conversationId}:${Date.now()}`,
      bodyFallback: `${disbander?.fullName ?? 'The group owner'} disbanded the group.`,
    });
    this.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);

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

    await enqueueNotifications(
      disbandNotifications,
      `group_disbanded:${conversationId}`,
      this.notificationPublisher,
      this.logger,
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
}
