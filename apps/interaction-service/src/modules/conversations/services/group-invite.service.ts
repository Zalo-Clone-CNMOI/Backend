import { Injectable, Logger, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, MoreThan, QueryFailedError } from 'typeorm';
import { NotificationOutboxPublisher } from '@libs/kafka/publisher/notification-outbox.publisher';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { CacheService } from '@libs/redis';
import {
  KafkaTopics,
  type GroupInviteAcceptedEvent,
  type GroupInviteCancelledEvent,
  type GroupInviteExpiredEvent,
  type GroupInviteRejectedEvent,
  type ConversationMemberAddedEvent,
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
} from '@app/types';
import {
  GetGroupInvitesQueryDto,
  GroupInviteItemDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
} from '../dto';
import { toGroupInviteItem } from '../helper/conversation-mapper';
import { ConversationCoreService } from './conversation-core.service';
import {
  publishGroupInviteKafkaOutbox,
  emitGroupInviteMessageUpdated,
  expireGroupInviteIfNeeded,
  fanOutSentInvites,
} from './group-invite.helpers';

@Injectable()
export class GroupInviteService {
  private readonly logger = new Logger(GroupInviteService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    @InjectRepository(ConversationInvite)
    private readonly inviteRepository: Repository<ConversationInvite>,
    private readonly notificationPublisher: NotificationOutboxPublisher,
    private readonly cacheService: CacheService,
    private readonly coreService: ConversationCoreService,
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
  ) {}

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
            messageId: crypto.randomUUID(),
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
      await publishGroupInviteKafkaOutbox(
        this.notificationPublisher,
        this.logger,
        KafkaTopics.GroupInviteExpired,
        expiredEvent,
      );
    }

    const inviter = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'fullName', 'avatarUrl'],
    });

    await fanOutSentInvites(
      {
        notificationPublisher: this.notificationPublisher,
        logger: this.logger,
        coreService: this.coreService,
        kafkaClient: this.kafkaClient,
      },
      {
        userId,
        conversationId,
        conversationName: txResult.conversationName,
        savedInvites: txResult.savedInvites,
        inviter,
      },
    );

    return {
      acceptedCount: txResult.savedInvites.length,
      skippedCount: dto.userIds.length - txResult.savedInvites.length,
      inviteIds: txResult.savedInvites.map((invite) => invite.id),
    };
  }

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

    const items = invites.map((invite) => toGroupInviteItem(invite));

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

    const items = invites.map((invite) => toGroupInviteItem(invite));

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

  async acceptGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    const result = await this.inviteRepository.manager.transaction(
      async (manager) => {
        const inviteRepo = manager.getRepository(ConversationInvite);
        const memberRepo = manager.getRepository(ConversationMember);
        const conversationRepo = manager.getRepository(Conversation);

        const invite = await inviteRepo
          .createQueryBuilder('invite')
          .setLock('pessimistic_write')
          .where('invite.id = :inviteId', { inviteId })
          .andWhere('invite.conversationId = :conversationId', {
            conversationId,
          })
          .andWhere('invite.invitedUserId = :userId', { userId })
          .getOne();

        if (!invite) {
          throw BusinessException.notFound(ErrorCode.GROUP_INVITE_NOT_FOUND);
        }

        const conversation = await conversationRepo
          .createQueryBuilder('conversation')
          .setLock('pessimistic_write')
          .where('conversation.id = :conversationId', { conversationId })
          .getOne();

        if (!conversation) {
          throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_FOUND);
        }

        if (conversation.createdById === null) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        if (invite.status === GroupInviteStatus.ACCEPTED) {
          return { alreadyDone: true, invite };
        }

        if (invite.status !== GroupInviteStatus.PENDING) {
          throw BusinessException.badRequest(
            ErrorCode.GROUP_INVITE_INVALID_STATUS,
          );
        }

        if (invite.expiresAt.getTime() <= Date.now()) {
          await inviteRepo.update(
            { id: invite.id, status: GroupInviteStatus.PENDING },
            {
              status: GroupInviteStatus.EXPIRED,
              respondedAt: new Date(),
            },
          );

          throw BusinessException.badRequest(ErrorCode.GROUP_INVITE_EXPIRED);
        }

        const existingMembership = await memberRepo
          .createQueryBuilder('member')
          .setLock('pessimistic_write')
          .where('member.conversationId = :conversationId', { conversationId })
          .andWhere('member.userId = :userId', { userId })
          .getOne();

        let membershipChanged = false;

        if (existingMembership) {
          if (existingMembership.leftAt !== null) {
            existingMembership.leftAt = null;
            existingMembership.role = UpdateMemberRoleDtoRoleEnum.MEMBER;
            await memberRepo.save(existingMembership);
            membershipChanged = true;
          }
        } else {
          await memberRepo.insert({
            conversationId,
            userId,
            role: UpdateMemberRoleDtoRoleEnum.MEMBER,
          });
          membershipChanged = true;
        }

        await inviteRepo.update(
          { id: invite.id, status: GroupInviteStatus.PENDING },
          {
            status: GroupInviteStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        );

        return {
          alreadyDone: false,
          membershipChanged,
          invite,
        };
      },
    );

    if (result.alreadyDone) {
      return { message: 'Already accepted' };
    }

    const respondedAt = Date.now();
    const acceptedEvent: GroupInviteAcceptedEvent = {
      invite_id: result.invite.id,
      conversation_id: conversationId,
      inviter_id: result.invite.inviterUserId,
      invited_user_id: userId,
      status: 'accepted',
      responded_at: respondedAt,
      trace_id: `group-invite-accepted:${result.invite.id}`,
    };
    await publishGroupInviteKafkaOutbox(
      this.notificationPublisher,
      this.logger,
      KafkaTopics.GroupInviteAccepted,
      acceptedEvent,
    );

    const joinedUser = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'fullName', 'avatarUrl'],
    });
    const memberAddedEvent: ConversationMemberAddedEvent = {
      conversation_id: conversationId,
      added_by: result.invite.inviterUserId,
      members: [
        {
          user_id: userId,
          full_name: joinedUser?.fullName ?? 'Unknown',
          avatar_url: joinedUser?.avatarUrl ?? null,
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        },
      ],
      added_at: respondedAt,
      trace_id: `conversation-member-added:${conversationId}:${userId}`,
    };
    await publishGroupInviteKafkaOutbox(
      this.notificationPublisher,
      this.logger,
      KafkaTopics.ConversationMemberAdded,
      memberAddedEvent,
    );

    if (result.invite) {
      await emitGroupInviteMessageUpdated(
        this.coreService,
        this.conversationRepository,
        this.userRepository,
        this.kafkaClient,
        result.invite,
        result.invite.inviterUserId,
        userId,
        conversationId,
        'accepted',
      );
    }

    return { message: 'Group invite accepted' };
  }

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

    const expired = await expireGroupInviteIfNeeded(
      this.inviteRepository,
      this.notificationPublisher,
      this.logger,
      this.coreService,
      this.conversationRepository,
      this.userRepository,
      this.kafkaClient,
      invite,
    );
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
    await publishGroupInviteKafkaOutbox(
      this.notificationPublisher,
      this.logger,
      KafkaTopics.GroupInviteRejected,
      rejectedEvent,
    );

    await emitGroupInviteMessageUpdated(
      this.coreService,
      this.conversationRepository,
      this.userRepository,
      this.kafkaClient,
      invite,
      invite.inviterUserId,
      userId,
      conversationId,
      'rejected',
    );

    return { message: 'Group invite rejected' };
  }

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

    const expired = await expireGroupInviteIfNeeded(
      this.inviteRepository,
      this.notificationPublisher,
      this.logger,
      this.coreService,
      this.conversationRepository,
      this.userRepository,
      this.kafkaClient,
      invite,
    );
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
    await publishGroupInviteKafkaOutbox(
      this.notificationPublisher,
      this.logger,
      KafkaTopics.GroupInviteCancelled,
      cancelledEvent,
    );

    await emitGroupInviteMessageUpdated(
      this.coreService,
      this.conversationRepository,
      this.userRepository,
      this.kafkaClient,
      invite,
      invite.inviterUserId,
      invite.invitedUserId,
      conversationId,
      'cancelled',
    );

    return { message: 'Group invite cancelled' };
  }
}
