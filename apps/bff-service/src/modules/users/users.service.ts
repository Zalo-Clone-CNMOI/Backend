import { Injectable, Logger } from '@nestjs/common';
import { UpdateProfileDto } from './dto';
import { PaginatedUserSearchResultDto } from '@app/clients';
import { SsoClientService, MediaClientService } from '@app/clients';
import { UserProfileResponseDto, PublicUserResponseDto } from './dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly ssoClient: SsoClientService,
    private readonly mediaClient: MediaClientService,
  ) {}

  /**
   * Get current user profile
   */
  async getMyProfile(accessToken: string): Promise<UserProfileResponseDto> {
    this.logger.log('Fetching current user profile');
    const profile = await this.ssoClient.getMyProfile(accessToken);
    return this.withResolvedAvatar(accessToken, profile);
  }

  /**
   * Update current user profile
   */
  async updateMyProfile(
    accessToken: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    this.logger.log('Updating current user profile');
    const profile = await this.ssoClient.updateMyProfile(accessToken, dto);
    return this.withResolvedAvatar(accessToken, profile);
  }

  /**
   * Search users by phone or name
   */
  async searchUsers(
    accessToken: string,
    q: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedUserSearchResultDto> {
    this.logger.log(`Searching users with query: ${q}`);
    return this.ssoClient.searchUsers(accessToken, q, page, limit);
  }

  /**
   * Get user public profile by ID
   */
  async getPublicProfile(
    accessToken: string,
    userId: string,
  ): Promise<PublicUserResponseDto> {
    this.logger.log(`Fetching public profile for user: ${userId}`);
    return this.ssoClient.getPublicProfile(accessToken, userId);
  }

  private async withResolvedAvatar(
    accessToken: string,
    profile: UserProfileResponseDto,
  ): Promise<UserProfileResponseDto> {
    const avatarRef = profile.avatarUrl?.trim();

    if (!avatarRef) {
      return profile;
    }

    if (/^https?:\/\//i.test(avatarRef)) {
      return {
        ...profile,
        avatarResolvedUrl: avatarRef,
      };
    }

    try {
      const currentUserId =
        profile.id ?? (await this.resolveCurrentUserId(accessToken));
      const signed = await this.mediaClient.presignDownload(
        { key: avatarRef },
        currentUserId,
      );

      return {
        ...profile,
        avatarResolvedUrl: signed.downloadUrl,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve avatar URL for key=${avatarRef}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return profile;
    }
  }

  private async resolveCurrentUserId(accessToken: string): Promise<string> {
    const me = await this.ssoClient.getMyProfile(accessToken);
    if (!me?.id) {
      throw new Error('Unable to resolve current user id for avatar signing');
    }

    return me.id;
  }
}
