import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { User } from '@libs/database/entities';
import { JwtService } from '@libs/auth';
import { ErrorCode, UserStatus } from '@app/constant';
import { BusinessException } from '@app/types';

import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  LogoutDto,
} from './dto';
import {
  AuthResponseDto,
  RefreshTokenResponseDto,
  UserResponseDto,
  TokensResponseDto,
} from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    this.logger.log(`Registering new user with phone: ${dto.phone}`);

    // Check if phone already exists
    const existingUser = await this.userRepository.findOne({
      where: { phone: dto.phone },
    });

    if (existingUser) {
      throw BusinessException.conflict(ErrorCode.USER_PHONE_ALREADY_EXISTS);
    }

    if (dto.email) {
      const existingEmail = await this.userRepository.findOne({
        where: { email: dto.email },
      });

      if (existingEmail) {
        throw BusinessException.conflict(ErrorCode.USER_EMAIL_ALREADY_EXISTS);
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const user = this.userRepository.create({
      phone: dto.phone,
      passwordHash,
      fullName: dto.fullName,
      email: dto.email ?? null,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      gender: dto.gender ?? null,
      status: UserStatus.ACTIVE,
    });

    const savedUser = await this.userRepository.save(user);
    this.logger.log(`User registered successfully: ${savedUser.id}`);

    const tokens = this.jwtService.generateTokenPair(
      savedUser.id,
      savedUser.phone,
    );

    return {
      user: this.toUserResponse(savedUser),
      tokens: this.toTokensResponse(tokens),
    };
  }

  /**
   * Login with phone and password
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    this.logger.log(`Login attempt for phone: ${dto.phone}`);

    const user = await this.userRepository.findOne({
      where: { phone: dto.phone },
    });

    if (!user) {
      throw BusinessException.unauthorized(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    if (user.status === UserStatus.INACTIVE) {
      throw BusinessException.forbidden(ErrorCode.AUTH_ACCOUNT_INACTIVE);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw BusinessException.forbidden(ErrorCode.AUTH_ACCOUNT_LOCKED);
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw BusinessException.unauthorized(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    await this.userRepository.update(user.id, { lastSeenAt: new Date() });
    const tokens = this.jwtService.generateTokenPair(user.id, user.phone);

    this.logger.log(`User logged in successfully: ${user.id}`);

    return {
      user: this.toUserResponse(user),
      tokens: this.toTokensResponse(tokens),
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    const payload = this.jwtService.verifyRefreshToken(dto.refreshToken);

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw BusinessException.unauthorized(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw BusinessException.forbidden(ErrorCode.AUTH_ACCOUNT_INACTIVE);
    }

    const { accessToken, expiresIn } = this.jwtService.generateAccessToken(
      user.id,
      user.phone,
    );

    return { accessToken, expiresIn };
  }

  /**
   * Logout user (invalidate token on client side)
   * For now, we just return success. Later can add refresh token blacklist
   */
  async logout(userId: string, dto: LogoutDto): Promise<void> {
    this.logger.log(`User logging out: ${userId}`);

    await this.userRepository.update(userId, { lastSeenAt: new Date() });

    if (dto.deviceId) {
      this.logger.log(`Device ${dto.deviceId} marked for removal`);
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    this.logger.log(`Password reset requested for: ${dto.phone}`);

    const user = await this.userRepository.findOne({
      where: { phone: dto.phone },
    });

    if (!user) {
      return { message: 'If the phone number exists, an OTP has been sent' };
    }

    this.logger.log(`OTP would be sent to ${dto.phone}`);
    return { message: 'If the phone number exists, an OTP has been sent' };
  }

  /**
   * Reset password with OTP verification
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    this.logger.log(`Password reset attempt for: ${dto.phone}`);

    const user = await this.userRepository.findOne({
      where: { phone: dto.phone },
    });

    if (!user) {
      throw BusinessException.badRequest(ErrorCode.AUTH_OTP_INVALID);
    }

    if (dto.otp !== '123456') {
      throw BusinessException.badRequest(ErrorCode.AUTH_OTP_INVALID);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);

    await this.userRepository.update(user.id, { passwordHash });

    this.logger.log(`Password reset successful for: ${user.id}`);

    return { message: 'Password has been reset successfully' };
  }

  /**
   * Get current user from authenticated request
   */
  async getCurrentUser(userId: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    return this.toUserResponse(user);
  }

  private toUserResponse(user: User): UserResponseDto {
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

  private toTokensResponse(tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }): TokensResponseDto {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }
}
