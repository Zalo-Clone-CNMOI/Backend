import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiResponse,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  ResetPasswordDto,
  AuthResponseDto,
  RefreshTokenResponseDto,
  QrGenerateDto,
  QrConfirmDto,
  QrRejectDto,
  QrSessionResponseDto,
} from './dto';
import type { QrStatusResponseDto as SdkQrStatusResponseDto } from '@app/clients';
import { seconds, Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
    summary: 'Logout user',
    description: 'Invalidates the refresh token',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(
    @Headers('authorization') authorization: string,
    @Body() dto: LogoutDto,
  ): Promise<{ message: string }> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }
    const accessToken = authorization.substring(7);
    return this.authService.logout(accessToken, dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password with Firebase token',
    description: 'Resets the user password after verifying Firebase token',
  })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid Firebase token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }

  // ==================== QR CODE LOGIN ENDPOINTS ====================

  @Post('qr/generate')
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @ApiOperation({
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
    description: 'Invalid request - socketBindingToken is required or invalid',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async qrGenerate(@Body() dto: QrGenerateDto): Promise<QrSessionResponseDto> {
    return this.authService.qrGenerate(dto);
  }

  @Get('qr/status/:sessionId')
  @Throttle({ default: { limit: 6, ttl: seconds(30) } })
  @ApiOperation({
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
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 410, description: 'Session expired' })
  async qrStatus(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<SdkQrStatusResponseDto> {
    return this.authService.qrStatus(sessionId);
  }

  @Post('qr/confirm')
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
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
  async qrConfirm(
    @Headers('authorization') authorization: string,
    @Body() dto: QrConfirmDto,
  ): Promise<{ message: string }> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }
    const accessToken = authorization.substring(7);
    return this.authService.qrConfirm(accessToken, dto);
  }

  @Post('qr/reject')
  @Throttle({ default: { limit: 2, ttl: seconds(30) } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
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
  async qrReject(
    @Headers('authorization') authorization: string,
    @Body() dto: QrRejectDto,
  ): Promise<{ message: string }> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }
    const accessToken = authorization.substring(7);
    return this.authService.qrReject(accessToken, dto);
  }
}
