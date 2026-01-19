import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Public, CurrentUser, ApiOperationDecorator } from '@app/decorator';
import { AuthenticatedUser } from '@app/types';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  LogoutDto,
  AuthResponseDto,
  RefreshTokenResponseDto,
  QrGenerateDto,
  QrConfirmDto,
  QrRejectDto,
  QrSessionResponseDto,
  QrStatusResponseDto,
} from './dto';
import { Throttle, seconds } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperationDecorator({
    summary: 'Register a new user account',
    description: 'Creates a new user with phone and password',
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Phone or email already exists' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperationDecorator({
    summary: 'Login with phone and password',
    description:
      'Returns access and refresh tokens upon successful authentication',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'User deactivated or banned' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  /**
   * Refresh access token using refresh token
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperationDecorator({
    summary: 'Refresh access token',
    description: 'Uses refresh token to get new access token',
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed',
    type: RefreshTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshToken(
    @Body() dto: RefreshTokenDto,
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshToken(dto);
  }

  /**
   * Logout user
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperationDecorator({
    summary: 'Logout user',
    description: 'Invalidates the refresh token',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<{ message: string }> {
    await this.authService.logout(user.id, dto);
    return { message: 'Logged out successfully' };
  }

  /**
   * Request password reset - sends OTP to phone
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperationDecorator({
    summary: 'Request password reset OTP',
    description: "Sends an OTP to the user's phone if it exists",
  })
  @ApiResponse({ status: 200, description: 'OTP sent if phone exists' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto);
  }

  /**
   * Reset password with OTP verification
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperationDecorator({
    summary: 'Reset password with OTP',
    description: 'Resets the user password after verifying OTP',
  })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid OTP' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }

  // ============================================
  // QR CODE LOGIN ENDPOINTS
  // ============================================

  /**
   * Generate QR code for login (PC)
   */
  @Public()
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @Post('qr/generate')
  @ApiOperationDecorator({
    summary: 'Generate QR code for login',
    description:
      'Creates a new QR login session for PC. PC should connect to WebSocket and wait for confirmation.',
  })
  @ApiResponse({
    status: 201,
    description: 'QR session created successfully',
    type: QrSessionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - socketId is required',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async generateQrSession(
    @Body() dto: QrGenerateDto,
  ): Promise<QrSessionResponseDto> {
    return this.authService.generateQrSession(dto);
  }

  /**
   * Get QR session status (polling fallback for PC)
   */
  @Public()
  @Get('qr/status/:sessionId')
  @ApiOperationDecorator({
    summary: 'Get QR session status',
    description:
      'Poll the status of a QR login session. Use this as fallback when WebSocket is unavailable.',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'QR session ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'QR session status',
    type: QrStatusResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 410, description: 'Session expired' })
  async getQrStatus(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<QrStatusResponseDto> {
    return this.authService.getQrStatus(sessionId);
  }

  /**
   * Confirm QR login from mobile
   */
  @Post('qr/confirm')
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperationDecorator({
    summary: 'Confirm QR login from mobile',
    description:
      'Mobile user confirms QR login after scanning. Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'QR login confirmed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid session ID' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - mobile user must be logged in',
  })
  @ApiResponse({ status: 404, description: 'Session not found or expired' })
  @ApiResponse({
    status: 409,
    description: 'Session already confirmed or rejected',
  })
  async confirmQrSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QrConfirmDto,
  ): Promise<{ message: string }> {
    return this.authService.confirmQrSession(user.id, dto);
  }

  /**
   * Reject QR login from mobile
   */
  @Post('qr/reject')
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperationDecorator({
    summary: 'Reject QR login from mobile',
    description: 'Mobile user rejects QR login after scanning.',
  })
  @ApiResponse({ status: 200, description: 'QR login rejected' })
  @ApiResponse({ status: 400, description: 'Invalid session ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found or expired' })
  @ApiResponse({
    status: 409,
    description: 'Session already confirmed or rejected',
  })
  async rejectQrSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QrRejectDto,
  ): Promise<{ message: string }> {
    return this.authService.rejectQrSession(user.id, dto);
  }
}
