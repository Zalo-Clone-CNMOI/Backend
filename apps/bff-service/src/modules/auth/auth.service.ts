import { Injectable, Logger } from '@nestjs/common';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  ResetPasswordDto,
  QrGenerateDto,
  QrConfirmDto,
  QrRejectDto,
} from './dto';
import {
  AuthResponseDto,
  RefreshTokenResponseDto,
  QrSessionResponseDto,
  QrStatusResponseDto,
} from '@app/clients';
import { SsoClientService } from '@app/clients';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly ssoClient: SsoClientService) {}

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    this.logger.log('Registering user with Firebase token');
    try {
      return this.ssoClient.register(dto);
    } catch (error) {
      this.logger.error(
        'Registration failed',
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
   * Reset password with Firebase token
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    this.logger.log(`Password reset with Firebase token`);
    return this.ssoClient.resetPassword(dto);
  }

  // ==================== QR CODE LOGIN METHODS ====================

  /**
   * Generate QR session for PC login
   */
  async qrGenerate(dto: QrGenerateDto): Promise<QrSessionResponseDto> {
    this.logger.log(`QR session generation for socket: ${dto.socketId}`);
    return this.ssoClient.qrGenerate(dto);
  }

  /**
   * Get QR session status (polling fallback)
   */
  async qrStatus(sessionId: string): Promise<QrStatusResponseDto> {
    this.logger.debug(`QR status check for session: ${sessionId}`);
    return this.ssoClient.qrStatus(sessionId);
  }

  /**
   * Confirm QR login from mobile
   */
  async qrConfirm(
    accessToken: string,
    dto: QrConfirmDto,
  ): Promise<{ message: string }> {
    this.logger.log(`QR confirm for session: ${dto.sessionId}`);
    return this.ssoClient.qrConfirm(accessToken, dto);
  }

  /**
   * Reject QR login from mobile
   */
  async qrReject(
    accessToken: string,
    dto: QrRejectDto,
  ): Promise<{ message: string }> {
    this.logger.log(`QR reject for session: ${dto.sessionId}`);
    return this.ssoClient.qrReject(accessToken, dto);
  }
}
