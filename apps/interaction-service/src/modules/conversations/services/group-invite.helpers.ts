import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import {
  KafkaTopics,
  type GroupInviteExpiredEvent,
  type ChatInviteMessageUpdatedEvent,
  type GroupInviteSentEvent,
  type NotificationRequestedEvent,
  type InviteMessageMetadata,
  type ChatInviteMessageCommand,
  NotificationType,
} from '@libs/contracts';
import {
  ConversationInvite,
  Conversation,
  User,
} from '@libs/database/entities';
import { GroupInviteStatus, MessageType } from '@app/constant';
import { BusinessException } from '@app/types';
import { ConversationCoreService } from './conversation-core.service';
import { enqueueNotifications } from '../helper/conversations-notification.helper';

export async function publishGroupInviteKafkaOutbox(
  notificationPublisher: NotificationOutboxPublisher,
  logger: Logger,
  topic: Parameters<NotificationOutboxPublisher['publishToTopic']>[0],
  payload: unknown,
): Promise<void> {
  const publisher = notificationPublisher as Pick<
    NotificationOutboxPublisher,
    'publishToTopic'
  >;
  const result = (await publisher.publishToTopic(
    topic,
    payload as never,
  )) as unknown;

  if (result === 'queued') {
    return;
  }

  const message = `[GroupInviteService] Failed to enqueue outbox event topic=${topic}`;
  logger.error(message);
  throw BusinessException.internal(message);
}

export async function emitGroupInviteMessageUpdated(
  coreService: ConversationCoreService,
  conversationRepository: Repository<Conversation>,
  userRepository: Repository<User>,
  kafkaClient: ClientKafka,
  invite: ConversationInvite,
  inviterUserId: string,
  invitedUserId: string,
  conversationId: string,
  status: 'accepted' | 'rejected' | 'cancelled' | 'expired',
): Promise<void> {
  if (!invite.messageId) return;

  const directConv = await coreService.createDirectConversation(inviterUserId, {
    participantId: invitedUserId,
  });

  const groupConv = await conversationRepository.findOne({
    where: { id: conversationId },
    select: ['name'],
  });

  const inviter = await userRepository.findOne({
    where: { id: inviterUserId },
    select: ['fullName'],
  });

  const event: ChatInviteMessageUpdatedEvent = {
    message_id: invite.messageId,
    conversation_id: directConv.id,
    metadata: {
      invite_id: invite.id,
      group_id: conversationId,
      group_name: groupConv?.name || 'Group',
      inviter_id: inviterUserId,
      inviter_name: inviter?.fullName ?? 'Unknown',
      status,
    },
    trace_id: `invite-msg-updated:${invite.id}:${status}`,
  };

  kafkaClient.emit(KafkaTopics.ChatInviteMessageUpdated, event);
}

export async function expireGroupInviteIfNeeded(
  inviteRepository: Repository<ConversationInvite>,
  notificationPublisher: NotificationOutboxPublisher,
  logger: Logger,
  coreService: ConversationCoreService,
  conversationRepository: Repository<Conversation>,
  userRepository: Repository<User>,
  kafkaClient: ClientKafka,
  invite: ConversationInvite,
): Promise<boolean> {
  if (invite.status !== GroupInviteStatus.PENDING) {
    return false;
  }

  if (invite.expiresAt.getTime() > Date.now()) {
    return false;
  }

  const respondedAt = new Date();
  const updateResult = await inviteRepository.update(
    { id: invite.id, status: GroupInviteStatus.PENDING },
    { status: GroupInviteStatus.EXPIRED, respondedAt },
  );
  if ((updateResult.affected ?? 0) !== 1) {
    const latestInvite = await inviteRepository.findOne({
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
  await publishGroupInviteKafkaOutbox(
    notificationPublisher,
    logger,
    KafkaTopics.GroupInviteExpired,
    expiredEvent,
  );

  await emitGroupInviteMessageUpdated(
    coreService,
    conversationRepository,
    userRepository,
    kafkaClient,
    invite,
    invite.inviterUserId,
    invite.invitedUserId,
    invite.conversationId,
    'expired',
  );

  return true;
}

export async function fanOutSentInvites(
  deps: {
    notificationPublisher: NotificationOutboxPublisher;
    logger: Logger;
    coreService: ConversationCoreService;
    kafkaClient: ClientKafka;
  },
  params: {
    userId: string;
    conversationId: string;
    conversationName: string | null;
    savedInvites: ConversationInvite[];
    inviter: {
      id: string;
      fullName?: string | null;
      avatarUrl?: string | null;
    } | null;
  },
): Promise<void> {
  const { userId, conversationId, conversationName, savedInvites, inviter } =
    params;

  const settled = await Promise.allSettled(
    savedInvites.map(async (invite) => {
      const sentEvent: GroupInviteSentEvent = {
        invite_id: invite.id,
        conversation_id: conversationId,
        inviter_id: userId,
        invited_user_id: invite.invitedUserId,
        inviter_full_name: inviter?.fullName ?? 'Unknown',
        conversation_name: conversationName,
        message: invite.message,
        expires_at: invite.expiresAt.getTime(),
        sent_at: invite.createdAt.getTime(),
        trace_id: `group-invite-sent:${invite.id}`,
      };
      await publishGroupInviteKafkaOutbox(
        deps.notificationPublisher,
        deps.logger,
        KafkaTopics.GroupInviteSent,
        sentEvent,
      );

      const directConv = await deps.coreService.createDirectConversation(
        userId,
        { participantId: invite.invitedUserId },
      );

      const inviteMsg: ChatInviteMessageCommand = {
        message_id: invite.messageId!,
        conversation_id: directConv.id,
        sender_id: userId,
        message_type: MessageType.INVITE,
        metadata: {
          invite_id: invite.id,
          group_id: conversationId,
          group_name: conversationName || 'Group',
          inviter_id: userId,
          inviter_name: inviter?.fullName ?? 'Unknown',
          status: 'pending',
        } satisfies InviteMessageMetadata,
        trace_id: `invite-msg-sent:${invite.id}`,
        body: `${inviter?.fullName ?? 'Someone'} invited you to join ${conversationName || 'a group'}.`,
        created_at: invite.createdAt.getTime(),
      };
      deps.kafkaClient.emit(KafkaTopics.ChatInviteMessageCreated, inviteMsg);

      const notification: NotificationRequestedEvent = {
        channel: 'push',
        user_id: invite.invitedUserId,
        title: 'Group invite',
        body: `${inviter?.fullName || 'Someone'} invited you to ${conversationName || 'a group'}`,
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
      return { invite, notification };
    }),
  );

  const inviteNotifications: NotificationRequestedEvent[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      inviteNotifications.push(outcome.value.notification);
      return;
    }
    const failedInvite = savedInvites[index];
    deps.logger.error(
      `[GroupInviteService] Per-invite side-effect failed invite_id=${failedInvite?.id} invited_user_id=${failedInvite?.invitedUserId}: ${
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason)
      }`,
    );
  });

  await enqueueNotifications(
    inviteNotifications,
    `group_invite_sent:${conversationId}`,
    deps.notificationPublisher,
    deps.logger,
  );
}
