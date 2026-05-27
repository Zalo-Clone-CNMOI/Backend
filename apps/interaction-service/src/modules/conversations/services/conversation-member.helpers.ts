import { Logger } from '@nestjs/common';
import { Repository, IsNull } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  KafkaTopics,
  type ConversationMemberRemovedEvent,
  type ConversationDisbandedEvent,
  type GroupInviteCancelledEvent,
  SystemEventType,
  type MemberLeftMetadata,
  type OwnerTransferredMetadata,
  type GroupDisbandedMetadata,
  NotificationType,
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
} from '@app/constant';
import { BusinessException } from '@app/types';
import { CacheService } from '@libs/redis';
import { enqueueNotifications } from '../helper/conversations-notification.helper';
import type { ConversationMemberRoleUpdatedEvent } from '@libs/contracts';

export async function emitOwnerTransferredEvent(
  kafkaClient: ClientKafka,
  userRepository: Repository<User>,
  conversationId: string,
  previousOwnerId: string,
  newOwnerId: string,
  previousRoleOfNewOwner: UpdateMemberRoleDtoRoleEnum,
): Promise<void> {
  const event: ConversationMemberRoleUpdatedEvent = {
    conversation_id: conversationId,
    updated_by: previousOwnerId,
    user_id: newOwnerId,
    previous_role: previousRoleOfNewOwner,
    current_role: UpdateMemberRoleDtoRoleEnum.OWNER,
    updated_at: Date.now(),
    trace_id: `conversation-owner-transferred:${conversationId}`,
  };
  kafkaClient.emit(KafkaTopics.ConversationMemberRoleUpdated, event);

  const [prevUser, newUser] = await Promise.all([
    userRepository.findOne({
      where: { id: previousOwnerId },
      select: ['fullName'],
    }),
    userRepository.findOne({
      where: { id: newOwnerId },
      select: ['fullName'],
    }),
  ]);

  const systemMsg = SystemMessageFactory.create({
    conversationId,
    systemEventType: SystemEventType.OWNER_TRANSFERRED,
    metadata: {
      previous_owner_id: previousOwnerId,
      previous_owner_name: prevUser?.fullName ?? 'Unknown',
      new_owner_id: newOwnerId,
      new_owner_name: newUser?.fullName ?? 'Unknown',
    } satisfies OwnerTransferredMetadata,
    traceId: `system-msg:owner-transferred:${conversationId}:${Date.now()}`,
    bodyFallback: `Ownership transferred to ${newUser?.fullName ?? 'a member'}.`,
  });
  kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);
}

export async function emitMemberLeftSystemMsg(
  kafkaClient: ClientKafka,
  userRepository: Repository<User>,
  conversationId: string,
  userId: string,
): Promise<void> {
  const leavingUser = await userRepository.findOne({
    where: { id: userId },
    select: ['fullName'],
  });
  const systemMsg = SystemMessageFactory.create({
    conversationId,
    systemEventType: SystemEventType.MEMBER_LEFT,
    metadata: {
      user_id: userId,
      user_name: leavingUser?.fullName ?? 'Unknown',
    } satisfies MemberLeftMetadata,
    traceId: `system-msg:member-left:${conversationId}:${Date.now()}`,
    bodyFallback: `${leavingUser?.fullName ?? 'A member'} left the group.`,
  });
  kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);
}

export async function leaveConversationCore(
  deps: {
    memberRepository: Repository<ConversationMember>;
    conversationRepository: Repository<Conversation>;
    kafkaClient: ClientKafka;
    userRepository: Repository<User>;
    cacheService: CacheService;
    disbandConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<{ message: string }>;
  },
  userId: string,
  conversationId: string,
): Promise<{ message: string }> {
  const txResult = await deps.memberRepository.manager.transaction(
    async (manager) => {
      const conversationRepo = manager.getRepository(Conversation);
      const memberRepo = manager.getRepository(ConversationMember);

      const conversation = await conversationRepo
        .createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :conversationId', { conversationId })
        .getOne();

      if (!conversation) {
        throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
      }

      if (
        conversation.type === ConversationType.DIRECT ||
        conversation.type === ConversationType.AI_ASSISTANT
      ) {
        // AI_ASSISTANT lifecycle is owned by AiConversationFactoryService —
        // "leaving" it would orphan the conversation with only the Zai bot
        // active. Users who want to drop a Zai chat need a dedicated
        // disband endpoint (Phase 6). Until then this is immutable, same
        // as DIRECT. removeMember (conversation-member.service.ts:305)
        // already rejects non-GROUP types so the abstraction is closed.
        throw BusinessException.badRequest(ErrorCode.CONVERSATION_CANNOT_LEAVE);
      }

      const activeMembers = await memberRepo.find({
        where: { conversationId, leftAt: IsNull() },
      });

      const myMembership = activeMembers.find((m) => m.userId === userId);
      if (!myMembership) {
        throw BusinessException.forbidden(ErrorCode.CONVERSATION_NOT_MEMBER);
      }

      if (
        myMembership.role === UpdateMemberRoleDtoRoleEnum.OWNER &&
        activeMembers.length === 1
      ) {
        return { action: 'sole_owner_disband' as const };
      }

      let transferredTo: {
        userId: string;
        previousRole: UpdateMemberRoleDtoRoleEnum;
      } | null = null;

      if (myMembership.role === UpdateMemberRoleDtoRoleEnum.OWNER) {
        const candidates = activeMembers.filter((m) => m.userId !== userId);
        const sortByJoined = (a: ConversationMember, b: ConversationMember) =>
          a.joinedAt.getTime() - b.joinedAt.getTime();
        const newOwner =
          candidates
            .filter((m) => m.role === UpdateMemberRoleDtoRoleEnum.ADMIN)
            .sort(sortByJoined)[0] || candidates.sort(sortByJoined)[0];

        if (!newOwner) {
          throw BusinessException.internal(
            'Owner transfer failed: no candidate',
          );
        }

        const demote = await memberRepo.update(
          {
            conversationId,
            userId,
            role: UpdateMemberRoleDtoRoleEnum.OWNER,
            leftAt: IsNull(),
          },
          { role: UpdateMemberRoleDtoRoleEnum.MEMBER },
        );
        if ((demote.affected ?? 0) !== 1) {
          throw BusinessException.conflict(
            ErrorCode.CONVERSATION_PERMISSION_DENIED,
          );
        }

        const promote = await memberRepo.update(
          {
            conversationId,
            userId: newOwner.userId,
            leftAt: IsNull(),
          },
          { role: UpdateMemberRoleDtoRoleEnum.OWNER },
        );
        if ((promote.affected ?? 0) !== 1) {
          throw BusinessException.internal('Owner transfer promote failed');
        }

        transferredTo = {
          userId: newOwner.userId,
          previousRole: newOwner.role,
        };
      }

      const leftAt = new Date();
      const leaveResult = await memberRepo.update(
        { conversationId, userId, leftAt: IsNull() },
        { leftAt },
      );
      if ((leaveResult.affected ?? 0) !== 1) {
        throw BusinessException.conflict(ErrorCode.CONVERSATION_NOT_MEMBER);
      }

      return { action: 'left' as const, transferredTo, leftAt };
    },
  );

  if (txResult.action === 'sole_owner_disband') {
    return deps.disbandConversation(userId, conversationId);
  }

  if (txResult.transferredTo) {
    await emitOwnerTransferredEvent(
      deps.kafkaClient,
      deps.userRepository,
      conversationId,
      userId,
      txResult.transferredTo.userId,
      txResult.transferredTo.previousRole,
    );
  }

  const removedEvent: ConversationMemberRemovedEvent = {
    conversation_id: conversationId,
    removed_by: userId,
    removed_user_id: userId,
    removed_at: txResult.leftAt.getTime(),
    trace_id: `conversation-member-left:${conversationId}`,
  };
  deps.kafkaClient.emit(KafkaTopics.ConversationMemberRemoved, removedEvent);

  await emitMemberLeftSystemMsg(
    deps.kafkaClient,
    deps.userRepository,
    conversationId,
    userId,
  );

  await deps.cacheService.invalidateConversationList(userId);
  await deps.cacheService.invalidateConversation(conversationId);
  return { message: 'Left conversation successfully' };
}

export async function disbandConversationCore(
  deps: {
    inviteRepository: Repository<ConversationInvite>;
    kafkaClient: ClientKafka;
    userRepository: Repository<User>;
    cacheService: CacheService;
    notificationPublisher: NotificationOutboxPublisher;
    logger: Logger;
  },
  userId: string,
  conversationId: string,
): Promise<{ message: string }> {
  const { activeMemberIds, cancelledInvites, disbandAt, conversationName } =
    await deps.inviteRepository.manager.transaction(async (manager) => {
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
        throw BusinessException.badRequest(ErrorCode.CONVERSATION_INVALID_TYPE);
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
    deps.kafkaClient.emit(KafkaTopics.GroupInviteCancelled, cancelledEvent);
  }

  const disbandedEvent: ConversationDisbandedEvent = {
    conversation_id: conversationId,
    disbanded_by: userId,
    member_ids: activeMemberIds,
    disbanded_at: disbandAt.getTime(),
    trace_id: `conversation-disbanded:${conversationId}`,
  };
  deps.kafkaClient.emit(KafkaTopics.ConversationDisbanded, disbandedEvent);

  const disbander = await deps.userRepository.findOne({
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
  deps.kafkaClient.emit(KafkaTopics.ChatSystemMessageCreated, systemMsg);

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
    deps.notificationPublisher,
    deps.logger,
  );

  await deps.cacheService.invalidateConversation(
    conversationId,
    activeMemberIds,
  );
  await Promise.all(
    activeMemberIds.map((memberId) =>
      deps.cacheService.invalidateConversationList(memberId),
    ),
  );

  return { message: 'Conversation disbanded successfully' };
}

/**
 * Disband (delete) an AI_ASSISTANT conversation. Companion to the Phase 5 W3
 * guard that blocks *leaving* AI conversations — the creator can dispose of a
 * Zai chat through this dedicated path.
 *
 * Differs from {@link disbandConversationCore}:
 *  - Type guard is AI_ASSISTANT, not GROUP.
 *  - Ownership is the creator link (`createdById`), since AI conversations have
 *    no OWNER role — both the user and Zai are MEMBER.
 *  - No group-invite teardown (AI conversations have none).
 *  - Deletes the Redis AI-routing marker so chat-service stops routing to Zai.
 *  - No system message / push notification: the only other member is the Zai
 *    bot, and the creator initiated the disband themselves.
 */
export async function disbandAiConversationCore(
  deps: {
    conversationRepository: Repository<Conversation>;
    kafkaClient: ClientKafka;
    cacheService: CacheService;
  },
  userId: string,
  conversationId: string,
): Promise<{ message: string }> {
  const { activeMemberIds, disbandAt } =
    await deps.conversationRepository.manager.transaction(async (manager) => {
      const conversationRepository = manager.getRepository(Conversation);
      const memberRepository = manager.getRepository(ConversationMember);

      const conversation = await conversationRepository
        .createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :conversationId', { conversationId })
        .getOne();

      if (!conversation) {
        throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
      }

      if (conversation.type !== ConversationType.AI_ASSISTANT) {
        throw BusinessException.badRequest(ErrorCode.CONVERSATION_INVALID_TYPE);
      }

      // AI conversations have no OWNER role, so ownership is the creator link.
      if (conversation.createdById !== userId) {
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

      return {
        activeMemberIds: activeMembers.map((member) => member.userId),
        disbandAt,
      };
    });

  // Stop chat-service from routing further messages to Zai for this id.
  await deps.cacheService.deleteAiConversationContext(conversationId);

  const disbandedEvent: ConversationDisbandedEvent = {
    conversation_id: conversationId,
    disbanded_by: userId,
    member_ids: activeMemberIds,
    disbanded_at: disbandAt.getTime(),
    trace_id: `ai-conversation-disbanded:${conversationId}`,
  };
  deps.kafkaClient.emit(KafkaTopics.ConversationDisbanded, disbandedEvent);

  await deps.cacheService.invalidateConversation(
    conversationId,
    activeMemberIds,
  );
  await Promise.all(
    activeMemberIds.map((memberId) =>
      deps.cacheService.invalidateConversationList(memberId),
    ),
  );

  return { message: 'AI conversation disbanded successfully' };
}
