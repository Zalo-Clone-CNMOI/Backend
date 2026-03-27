import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not } from 'typeorm';

import { User, Friendship, MediaFile } from '@libs/database/entities';
import { ErrorCode, UserStatus, FriendshipStatus } from '@app/constant';
import {
  BusinessException,
  PaginatedResponse,
  PaginationMeta,
} from '@app/types';
import { CacheService } from '@libs/redis';

import {
  UpdateProfileDto,
  SearchUsersDto,
  UserProfileResponseDto,
  PublicUserResponseDto,
  UserSearchResultDto,
} from './dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Friendship)
    private readonly friendshipRepository: Repository<Friendship>,
    @InjectRepository(MediaFile)
    private readonly mediaFileRepo: Repository<MediaFile>,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Get current user profile
   */
  async getMyProfile(userId: string): Promise<UserProfileResponseDto> {
    // Try cache first
    const cached =
      await this.cacheService.getUserProfile<UserProfileResponseDto>(userId);
    if (cached) {
      this.logger.debug(`User profile cache HIT: ${userId}`);
      return cached;
    }

    this.logger.debug(`User profile cache MISS: ${userId}`);

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const profile = this.toProfileResponse(user);

    // Cache for future requests
    await this.cacheService.setUserProfile(userId, profile);

    return profile;
  }

  /**
   * Update current user profile
   */
  async updateMyProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    if (dto.email && dto.email !== user.email) {
      const existingEmail = await this.userRepository.findOne({
        where: { email: dto.email },
      });

      if (existingEmail) {
        throw BusinessException.conflict(ErrorCode.USER_EMAIL_ALREADY_EXISTS);
      }
    }

    const updateData: Partial<User> = {};

    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.bio !== undefined) updateData.bio = dto.bio;
    if (dto.avatarUrl !== undefined) {
      const file = await this.mediaFileRepo.findOne({
        where: { key: dto.avatarUrl },
      });
      if (!file || file.uploadedById !== userId || file.status !== 'uploaded') {
        throw BusinessException.badRequest(ErrorCode.MEDIA_PERMISSION_DENIED);
      }
      updateData.avatarUrl = dto.avatarUrl;
    }
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) {
      updateData.dateOfBirth = new Date(dto.dateOfBirth);
    }

    await this.userRepository.update(userId, updateData);

    const updatedUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    this.logger.log(`User profile updated: ${userId}`);

    const profile = this.toProfileResponse(updatedUser!);

    // Invalidate cache (will be repopulated on next read)
    await this.cacheService.invalidateUser(userId);
    this.logger.debug(`User cache invalidated after profile update: ${userId}`);

    return profile;
  }

  /**
   * Get user by ID (public profile)
   */
  async getUserById(
    userId: string,
    currentUserId: string,
  ): Promise<PublicUserResponseDto> {
    // Try cache first
    const cached =
      await this.cacheService.getUserPublic<PublicUserResponseDto>(userId);
    if (cached) {
      this.logger.debug(`User public profile cache HIT: ${userId}`);
      // Still need to check blocking status (not cached)
      const isBlocked = await this.friendshipRepository.findOne({
        where: [
          {
            requesterId: userId,
            addresseeId: currentUserId,
            status: FriendshipStatus.BLOCKED,
          },
        ],
      });

      if (isBlocked) {
        throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
      }

      return cached;
    }

    this.logger.debug(`User public profile cache MISS: ${userId}`);

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    // Check if current user is blocked by target user
    const isBlocked = await this.friendshipRepository.findOne({
      where: [
        {
          requesterId: userId,
          addresseeId: currentUserId,
          status: FriendshipStatus.BLOCKED,
        },
      ],
    });

    if (isBlocked) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const publicProfile = this.toPublicResponse(user);

    // Cache for future requests
    await this.cacheService.setUserPublic(userId, publicProfile);

    return publicProfile;
  }

  /**
   * Search users by phone or name
   */
  async searchUsers(
    dto: SearchUsersDto,
    currentUserId: string,
  ): Promise<PaginatedResponse<UserSearchResultDto>> {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50); // Max 50 per page
    const offset = (page - 1) * limit;

    // Build search condition
    const searchQuery = dto.q.trim();

    // Search by name or phone
    const [users, total] = await this.userRepository.findAndCount({
      where: [
        {
          fullName: ILike(`%${searchQuery}%`),
          id: Not(currentUserId),
          status: UserStatus.ACTIVE,
        },
        {
          phone: ILike(`%${searchQuery}%`),
          id: Not(currentUserId),
          status: UserStatus.ACTIVE,
        },
      ],
      skip: offset,
      take: limit,
      order: { fullName: 'ASC' },
    });

    // Get friendship status for each user
    const userIds = users.map((u) => u.id);
    const friendships = await this.getFriendshipsForUsers(
      currentUserId,
      userIds,
    );

    // Map to response
    const items = users.map((user) =>
      this.toSearchResult(user, friendships.get(user.id)),
    );

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
   * Get friendships for multiple users
   */
  private async getFriendshipsForUsers(
    currentUserId: string,
    userIds: string[],
  ): Promise<Map<string, { status: FriendshipStatus; isRequester: boolean }>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const friendships = await this.friendshipRepository
      .createQueryBuilder('f')
      .where(
        '(f.requesterId = :currentUserId AND f.addresseeId IN (:...userIds)) OR (f.addresseeId = :currentUserId AND f.requesterId IN (:...userIds))',
        { currentUserId, userIds },
      )
      .getMany();

    const map = new Map<
      string,
      { status: FriendshipStatus; isRequester: boolean }
    >();

    for (const f of friendships) {
      const otherUserId =
        f.requesterId === currentUserId ? f.addresseeId : f.requesterId;
      const isRequester = f.requesterId === currentUserId;
      map.set(otherUserId, {
        status: f.status,
        isRequester,
      });
    }

    return map;
  }

  /**
   * Convert User entity to profile response
   */
  private toProfileResponse(user: User): UserProfileResponseDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  /**
   * Convert User entity to public response
   */
  private toPublicResponse(user: User): PublicUserResponseDto {
    return {
      id: user.id,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      status: user.status,
    };
  }

  /**
   * Convert User to search result
   */
  private toSearchResult(
    user: User,
    friendship?: { status: FriendshipStatus; isRequester: boolean },
  ): UserSearchResultDto {
    // Mask phone number for privacy
    const maskedPhone = this.maskPhone(user.phone);

    let friendshipStatus: UserSearchResultDto['friendshipStatus'] = 'none';

    if (friendship) {
      if (friendship.status === FriendshipStatus.ACCEPTED) {
        friendshipStatus = 'friends';
      } else if (friendship.status === FriendshipStatus.BLOCKED) {
        friendshipStatus = 'blocked';
      } else if (friendship.status === FriendshipStatus.PENDING) {
        friendshipStatus = friendship.isRequester
          ? 'pending_sent'
          : 'pending_received';
      }
    }

    return {
      id: user.id,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      phone: maskedPhone,
      friendshipStatus,
    };
  }

  /**
   * Mask phone number for privacy
   * +84901234567 -> +84***234567
   */
  private maskPhone(phone: string): string {
    if (phone.length < 6) return phone;
    const start = phone.slice(0, 3);
    const end = phone.slice(-6);
    return `${start}***${end}`;
  }
}
