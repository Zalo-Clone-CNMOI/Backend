import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { AuthApi, UsersApi } from './client/generated';
import type {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  AuthResponseDto,
  RefreshTokenResponseDto,
  UpdateProfileDto,
  UserProfileResponseDto,
  PublicUserResponseDto,
  PaginatedUserSearchResultDto,
} from './client/generated';

@Injectable()
export class SsoClientService {
  private readonly logger = new Logger(SsoClientService.name);

  constructor(
    private readonly authApi: AuthApi,
    private readonly usersApi: UsersApi,
  ) {}

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
   * Request password reset OTP
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    try {
      const response = await this.authApi.forgotPassword({
        forgotPasswordDto: dto,
      });
      return { message: response.data.message || 'OTP sent successfully' };
    } catch (error) {
      this.handleError('forgotPassword', error);
    }
  }

  /**
   * Reset password with OTP
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
      return response.data;
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

  // ==================== ERROR HANDLING ====================

  private handleError(method: string, error: unknown): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const message =
        (error.response?.data as { message?: string })?.message ||
        error.message;
      const errorData = error.response?.data as {
        error?: string;
        [key: string]: unknown;
      };

      this.logger.error(
        `SSO Client error in ${method}: ${status} - ${message}`,
        error.stack,
      );

      // Re-throw with structured error data
      const structuredError = new Error(message);
      Object.assign(structuredError, {
        statusCode: status || 500,
        message: message,
        error: errorData?.error || 'Internal Server Error',
        data: errorData,
      });
      throw structuredError;
    }

    // Handle non-Axios errors
    this.logger.error(`Unexpected error in ${method}`, error);
    const genericError = new Error('Internal server error');
    Object.assign(genericError, {
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    throw genericError;
  }
}
