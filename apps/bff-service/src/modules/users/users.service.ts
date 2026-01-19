import { Injectable, Logger } from '@nestjs/common';
import { UpdateProfileDto } from './dto';
import {
  UserProfileResponseDto,
  PublicUserResponseDto,
  PaginatedUserSearchResultDto,
} from '@app/clients';
import { SsoClientService } from '@app/clients';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly ssoClient: SsoClientService) {}

  /**
   * Get current user profile
   */
  async getMyProfile(accessToken: string): Promise<UserProfileResponseDto> {
    this.logger.log('Fetching current user profile');
    return this.ssoClient.getMyProfile(accessToken);
  }

  /**
   * Update current user profile
   */
  async updateMyProfile(
    accessToken: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    this.logger.log('Updating current user profile');
    return this.ssoClient.updateMyProfile(accessToken, dto);
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
}
