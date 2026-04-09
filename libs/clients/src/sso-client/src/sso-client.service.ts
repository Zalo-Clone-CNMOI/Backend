import { Injectable, Logger } from '@nestjs/common';
import { AuthApi, UsersApi, DeviceTokensApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  ResetPasswordDto,
  AuthResponseDto,
  RefreshTokenResponseDto,
  UpdateProfileDto,
  UserProfileResponseDto,
  PublicUserResponseDto,
  PaginatedUserSearchResultDto,
  QrGenerateDto,
  QrSessionResponseDto,
  QrStatusResponseDto,
  QrConfirmDto,
  QrRejectDto,
  RegisterDeviceTokenDto,
  DeviceTokenResponseDto,
} from './client/generated';

@Injectable()
export class SsoClientService extends BaseHttpClient {
  protected readonly logger = new Logger(SsoClientService.name);

  constructor(
    private readonly authApi: AuthApi,
    private readonly usersApi: UsersApi,
    private readonly deviceTokensApi: DeviceTokensApi,
  ) {
    super();
  }

  // ==================== AUTH METHODS ====================

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    try {
      const response = await this.authApi.register({ registerDto: dto });
      return response.data;
    } catch (error) {
      this.handleError('register', error);
    }
  }

  /**
   * Login with phone and password
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    try {
      const response = await this.authApi.login({ loginDto: dto });
      return response.data;
    } catch (error) {
      this.handleError('login', error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    try {
      const response = await this.authApi.refreshToken({
        refreshTokenDto: dto,
      });
      return response.data;
    } catch (error) {
      this.handleError('refreshToken', error);
    }
  }

  /**
   * Logout user
   */
  async logout(
    accessToken: string,
    dto: LogoutDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.authApi.logout(
        { logoutDto: dto },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return { message: response.data.message || 'Logged out successfully' };
    } catch (error) {
      this.handleError('logout', error);
    }
  }

  /**
   * Reset password with Firebase token
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    try {
      const response = await this.authApi.resetPassword({
        resetPasswordDto: dto,
      });
      return {
        message: response.data.message || 'Password reset successfully',
      };
    } catch (error) {
      this.handleError('resetPassword', error);
    }
  }

  // ==================== QR CODE LOGIN METHODS ====================

  /**
   * Generate QR session for PC login
   */
  async qrGenerate(dto: QrGenerateDto): Promise<QrSessionResponseDto> {
    try {
      const response = await this.authApi.authQrGenerate({
        qrGenerateDto: dto,
      });
      return response.data;
    } catch (error) {
      this.handleError('qrGenerate', error);
    }
  }

  /**
   * Get QR session status (polling fallback)
   */
  async qrStatus(sessionId: string): Promise<QrStatusResponseDto> {
    try {
      const response = await this.authApi.authQrStatus({ sessionId });
      return response.data;
    } catch (error) {
      this.handleError('qrStatus', error);
    }
  }

  /**
   * Confirm QR login from mobile
   */
  async qrConfirm(
    accessToken: string,
    dto: QrConfirmDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.authApi.authQrConfirm(
        { qrConfirmDto: dto },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return {
        message: response.data.message || 'QR login confirmed successfully',
      };
    } catch (error) {
      this.handleError('qrConfirm', error);
    }
  }

  /**
   * Reject QR login from mobile
   */
  async qrReject(
    accessToken: string,
    dto: QrRejectDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.authApi.authQrReject(
        { qrRejectDto: dto },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return { message: response.data.message || 'QR login rejected' };
    } catch (error) {
      this.handleError('qrReject', error);
    }
  }

  // ==================== USER METHODS ====================

  /**
   * Get current user profile
   */
  async getMyProfile(accessToken: string): Promise<UserProfileResponseDto> {
    try {
      const response = await this.usersApi.getMyProfile({
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = response.data as unknown as {
        data?: UserProfileResponseDto;
      };
      return body.data ?? response.data;
    } catch (error) {
      this.handleError('getMyProfile', error);
    }
  }

  /**
   * Update current user profile
   */
  async updateMyProfile(
    accessToken: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    try {
      const response = await this.usersApi.updateMyProfile(
        { updateProfileDto: dto },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('updateMyProfile', error);
    }
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
    try {
      const response = await this.usersApi.searchUsers(
        { q, page, limit },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('searchUsers', error);
    }
  }

  /**
   * Get user public profile by ID
   */
  async getPublicProfile(
    accessToken: string,
    userId: string,
  ): Promise<PublicUserResponseDto> {
    try {
      const response = await this.usersApi.getPublicProfile(
        { userId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('getPublicProfile', error);
    }
  }

  // ==================== DEVICE TOKEN METHODS ====================

  /**
   * Register or update device token
   */
  async registerDeviceToken(
    accessToken: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    try {
      const response = await this.deviceTokensApi.registerDeviceToken(
        { registerDeviceTokenDto: dto },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('registerDeviceToken', error);
    }
  }

  /**
   * Get all device tokens for current user
   */
  async getUserDeviceTokens(
    accessToken: string,
  ): Promise<DeviceTokenResponseDto[]> {
    try {
      const response = await this.deviceTokensApi.getUserDeviceTokens({
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError('getUserDeviceTokens', error);
    }
  }

  /**
   * Delete a specific device token
   */
  async deleteDeviceToken(
    accessToken: string,
    tokenId: string,
  ): Promise<{ success: boolean }> {
    try {
      const response = await this.deviceTokensApi.deleteDeviceToken(
        { tokenId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return { success: response.data.success ?? true };
    } catch (error) {
      this.handleError('deleteDeviceToken', error);
    }
  }

  /**
   * Delete all device tokens for current user
   */
  async deleteAllDeviceTokens(accessToken: string): Promise<{ count: number }> {
    try {
      const response = await this.deviceTokensApi.deleteAllDeviceTokens({
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return { count: response.data.count ?? 0 };
    } catch (error) {
      this.handleError('deleteAllDeviceTokens', error);
    }
  }
}
