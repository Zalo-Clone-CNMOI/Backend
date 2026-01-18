import { Injectable, Logger } from '@nestjs/common';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';
import { AuthResponseDto, RefreshTokenResponseDto } from '@app/clients';
import { SsoClientService } from '@app/clients';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly ssoClient: SsoClientService) {}

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    this.logger.log(`Registering user with phone: ${dto.phone}`);
    try {
      return this.ssoClient.register(dto);
    } catch (error) {
      this.logger.error(
        `Registration failed for phone: ${dto.phone}`,
        error instanceof Error ? error.stack : '',
      );
      throw error;
    }
  }

  /**
   * Login with phone and password
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    this.logger.log(`User login attempt: ${dto.phone}`);
    return this.ssoClient.login(dto);
  }

  /**
   * Refresh access token
   */
  async refreshToken(dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    this.logger.log('Token refresh request');
    return this.ssoClient.refreshToken(dto);
  }

  /**
   * Logout user
   */
  async logout(
    accessToken: string,
    dto: LogoutDto,
  ): Promise<{ message: string }> {
    this.logger.log('User logout');
    return this.ssoClient.logout(accessToken, dto);
  }

  /**
   * Request password reset OTP
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    this.logger.log(`Password reset requested for: ${dto.phone}`);
    return this.ssoClient.forgotPassword(dto);
  }

  /**
   * Reset password with OTP
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    this.logger.log(`Password reset for: ${dto.phone}`);
    return this.ssoClient.resetPassword(dto);
  }
}
