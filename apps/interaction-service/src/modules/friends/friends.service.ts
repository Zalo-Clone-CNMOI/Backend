import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User, Friendship } from '@libs/database/entities';
import { ErrorCode, FriendshipStatus, UserStatus } from '@app/constant';
import {
  type NotificationRequestedEvent,
  NotificationType,
  KafkaTopics,
} from '@libs/contracts';
import {
  BusinessException,
  PaginatedResponse,
  PaginationMeta,
  PaginationQuery,
} from '@app/types';
import { CacheService } from '@libs/redis';

import {
  SendFriendRequestDto,
  RespondFriendRequestDto,
  FriendResponseDto,
  FriendRequestResponseDto,
  SentFriendRequestResponseDto,
  RespondFriendRequestDtoActionEnum,
} from './dto';
import { KAFKA_CLIENT } from '@libs/kafka';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly QR_SESSION_TTL_SECONDS = 300; // 5 minutes

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Friendship)
    private readonly friendshipRepository: Repository<Friendship>,
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Get list of friends
   */
  async getFriends(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<FriendResponseDto>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const qb = this.friendshipRepository
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.requester', 'requester')
      .leftJoinAndSelect('f.addressee', 'addressee')
      .where('f.status = :status', { status: FriendshipStatus.ACCEPTED })
      .andWhere('(f.requesterId = :userId OR f.addresseeId = :userId)', {
        userId,
      })
      .orderBy('f.updatedAt', 'DESC')
      .skip(offset)
      .take(limit);

    const [friendships, total] = await qb.getManyAndCount();

    const items = friendships.map((f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return this.toFriendResponse(friend, f.updatedAt);
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
   * Get pending friend requests (received)
   */
  async getPendingRequests(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<FriendRequestResponseDto>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const [requests, total] = await this.friendshipRepository.findAndCount({
      where: {
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
      },
      relations: ['requester'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const items = requests.map((r) => this.toFriendRequestResponse(r));

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
   * Get sent friend requests
   */
  async getSentRequests(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<SentFriendRequestResponseDto>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const [requests, total] = await this.friendshipRepository.findAndCount({
      where: {
        requesterId: userId,
        status: FriendshipStatus.PENDING,
      },
      relations: ['addressee'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const items = requests.map((r) => this.toSentRequestResponse(r));

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
   * Send friend request
   */
  async sendFriendRequest(
    userId: string,
    dto: SendFriendRequestDto,
  ): Promise<{ message: string; requestId: string }> {
    const { userId: targetUserId } = dto;

    if (userId === targetUserId) {
      throw BusinessException.badRequest(ErrorCode.FRIEND_CANNOT_ADD_SELF);
    }

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
    });

    if (!targetUser || targetUser.status !== UserStatus.ACTIVE) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const existingFriendship = await this.friendshipRepository.findOne({
      where: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    });

    if (existingFriendship) {
      if (existingFriendship.status === FriendshipStatus.ACCEPTED) {
        throw BusinessException.conflict(ErrorCode.FRIEND_ALREADY_FRIENDS);
      }
      if (existingFriendship.status === FriendshipStatus.PENDING) {
        throw BusinessException.conflict(
          ErrorCode.FRIEND_REQUEST_ALREADY_EXISTS,
        );
      }
      if (existingFriendship.status === FriendshipStatus.BLOCKED) {
        throw BusinessException.forbidden(ErrorCode.FRIEND_USER_BLOCKED);
      }
    }

    const friendRequest = this.friendshipRepository.create({
      requesterId: userId,
      addresseeId: targetUserId,
      status: FriendshipStatus.PENDING,
    });

    const saved = await this.friendshipRepository.save(friendRequest);
    this.logger.log(`Friend request sent: ${userId} -> ${targetUserId}`);

    const requester = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'fullName', 'avatarUrl', 'phone'],
    });

    this.kafkaClient.emit(KafkaTopics.SendFriendRequest, {
      requestId: saved.id,
      requesterId: userId,
      addresseeId: targetUserId,
      requester: {
        id: requester?.id,
        fullName: requester?.fullName,
        avatarUrl: requester?.avatarUrl,
        phone: requester?.phone,
      },
      trace_id: `friend-req:${saved.id}`,
    });

    // Emit notification to addressee
    const notification: NotificationRequestedEvent = {
      channel: 'push',
      user_id: targetUserId,
      title: 'New friend request',
      body: `${requester?.fullName || 'Someone'} sent you a friend request`,
      type: NotificationType.FriendRequest,
      data: {
        request_id: saved.id,
        requester_id: userId,
      },
      rich: {
        image_url: requester?.avatarUrl || undefined,
        priority: 'normal',
        category: 'friend_request',
      },
      requested_at: Date.now(),
      trace_id: `friend-req:${saved.id}`,
    };
    this.kafkaClient.emit(KafkaTopics.NotificationRequested, notification);

    return { message: 'Friend request sent successfully', requestId: saved.id };
  }

  /**
   * Respond to friend request (accept/reject)
   */
  async respondToRequest(
    userId: string,
    requestId: string,
    dto: RespondFriendRequestDto,
  ): Promise<{ message: string }> {
    const request = await this.friendshipRepository.findOne({
      where: { id: requestId, addresseeId: userId },
      relations: ['requester'],
    });

    if (!request) {
      throw BusinessException.notFound(ErrorCode.FRIEND_REQUEST_NOT_FOUND);
    }

    if (request.status !== FriendshipStatus.PENDING) {
      throw BusinessException.badRequest(ErrorCode.FRIEND_REQUEST_NOT_FOUND);
    }

    if (dto.action === RespondFriendRequestDtoActionEnum.accept) {
      request.status = FriendshipStatus.ACCEPTED;
      await this.friendshipRepository.save(request);
      this.logger.log(`Friend request accepted: ${request.id}`);

      await this.cacheService.invalidateFriendLists([
        request.requesterId,
        request.addresseeId,
      ]);

      // Get addressee info for notification
      const addressee = await this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'fullName', 'avatarUrl'],
      });

      this.kafkaClient.emit(KafkaTopics.RespondFriendRequest, {
        requestId: request.id,
        requesterId: request.requesterId,
        addresseeId: request.addresseeId,
        status: 'accepted',
        addressee: {
          id: addressee?.id,
          fullName: addressee?.fullName,
          avatarUrl: addressee?.avatarUrl,
        },
        trace_id: `friend-accept:${request.id}`,
      });

      // Emit notification to requester that their request was accepted
      const acceptNotification: NotificationRequestedEvent = {
        channel: 'push',
        user_id: request.requesterId,
        title: 'Friend request accepted',
        body: `${addressee?.fullName || 'Someone'} accepted your friend request`,
        type: NotificationType.FriendAccepted,
        data: {
          request_id: request.id,
          friend_id: userId,
        },
        rich: {
          image_url: addressee?.avatarUrl || undefined,
          priority: 'normal',
          category: 'friend_accepted',
        },
        requested_at: Date.now(),
        trace_id: `friend-accept:${request.id}`,
      };
      this.kafkaClient.emit(
        KafkaTopics.NotificationRequested,
        acceptNotification,
      );

      return { message: 'Friend request accepted' };
    } else {
      await this.friendshipRepository.remove(request);
      this.logger.log(`Friend request rejected: ${request.id}`);

      this.kafkaClient.emit(KafkaTopics.RespondFriendRequest, {
        requestId: request.id,
        requesterId: request.requesterId,
        addresseeId: request.addresseeId,
        status: 'rejected',
        trace_id: `friend-reject:${request.id}`,
      });

      return { message: 'Friend request rejected' };
    }
  }

  /**
   * Cancel sent friend request
   */
  async cancelRequest(
    userId: string,
    requestId: string,
  ): Promise<{ message: string }> {
    const request = await this.friendshipRepository.findOne({
      where: {
        id: requestId,
        requesterId: userId,
        status: FriendshipStatus.PENDING,
      },
    });

    if (!request) {
      throw BusinessException.notFound(ErrorCode.FRIEND_REQUEST_NOT_FOUND);
    }

    await this.friendshipRepository.remove(request);
    this.logger.log(`Friend request cancelled: ${requestId}`);

    this.kafkaClient.emit(KafkaTopics.CancelFriendRequest, {
      requestId: request.id,
      requesterId: userId,
      addresseeId: request.addresseeId,
      trace_id: `friend-cancel:${requestId}`,
    });

    return { message: 'Friend request cancelled' };
  }

  /**
   * Remove friend (unfriend)
   */
  async removeFriend(
    userId: string,
    friendId: string,
  ): Promise<{ message: string }> {
    const friendship = await this.friendshipRepository.findOne({
      where: [
        {
          requesterId: userId,
          addresseeId: friendId,
          status: FriendshipStatus.ACCEPTED,
        },
        {
          requesterId: friendId,
          addresseeId: userId,
          status: FriendshipStatus.ACCEPTED,
        },
      ],
    });

    if (!friendship) {
      throw BusinessException.notFound(ErrorCode.FRIEND_NOT_FOUND);
    }

    await this.friendshipRepository.remove(friendship);
    this.logger.log(`Friend removed: ${userId} <-> ${friendId}`);

    await this.cacheService.invalidateFriendLists([userId, friendId]);

    // Notify the other user
    this.kafkaClient.emit(KafkaTopics.FriendRemoved, {
      userId,
      friendId,
      trace_id: `friend-remove:${userId}:${friendId}`,
    });

    return { message: 'Friend removed successfully' };
  }

  /**
   * Block user
   */
  async blockUser(
    userId: string,
    targetUserId: string,
  ): Promise<{ message: string }> {
    if (userId === targetUserId) {
      throw BusinessException.badRequest(ErrorCode.FRIEND_CANNOT_ADD_SELF);
    }

    let friendship = await this.friendshipRepository.findOne({
      where: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    });

    if (friendship) {
      friendship.status = FriendshipStatus.BLOCKED;
      if (friendship.requesterId !== userId) {
        await this.friendshipRepository.remove(friendship);
        friendship = this.friendshipRepository.create({
          requesterId: userId,
          addresseeId: targetUserId,
          status: FriendshipStatus.BLOCKED,
        });
      }
      await this.friendshipRepository.save(friendship);
    } else {
      friendship = this.friendshipRepository.create({
        requesterId: userId,
        addresseeId: targetUserId,
        status: FriendshipStatus.BLOCKED,
      });
      await this.friendshipRepository.save(friendship);
    }

    this.logger.log(`User blocked: ${userId} blocked ${targetUserId}`);
    return { message: 'User blocked successfully' };
  }

  /**
   * Unblock user
   */
  async unblockUser(
    userId: string,
    targetUserId: string,
  ): Promise<{ message: string }> {
    const friendship = await this.friendshipRepository.findOne({
      where: {
        requesterId: userId,
        addresseeId: targetUserId,
        status: FriendshipStatus.BLOCKED,
      },
    });

    if (!friendship) {
      throw BusinessException.notFound(ErrorCode.FRIEND_USER_BLOCKED);
    }

    await this.friendshipRepository.remove(friendship);
    this.logger.log(`User unblocked: ${userId} unblocked ${targetUserId}`);

    return { message: 'User unblocked successfully' };
  }

  /**
   * Convert to FriendResponseDto
   */
  private toFriendResponse(user: User, friendsSince: Date): FriendResponseDto {
    return {
      id: user.id,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      lastSeenAt: user.lastSeenAt,
      friendsSince,
    };
  }

  /**
   * Convert to FriendRequestResponseDto
   */
  private toFriendRequestResponse(
    friendship: Friendship,
  ): FriendRequestResponseDto {
    return {
      id: friendship.id,
      user: {
        id: friendship.requester.id,
        fullName: friendship.requester.fullName,
        avatarUrl: friendship.requester.avatarUrl,
        phone: friendship.requester.phone,
      },
      message: null, // TODO: Add message field to friendship entity
      createdAt: friendship.createdAt,
    };
  }

  /**
   * Convert to SentFriendRequestResponseDto
   */
  private toSentRequestResponse(
    friendship: Friendship,
  ): SentFriendRequestResponseDto {
    return {
      id: friendship.id,
      user: {
        id: friendship.addressee.id,
        fullName: friendship.addressee.fullName,
        avatarUrl: friendship.addressee.avatarUrl,
      },
      createdAt: friendship.createdAt,
    };
  }
}
