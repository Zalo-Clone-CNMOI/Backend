import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User } from '@libs/database/entities';
import { JwtService } from '@libs/auth';
import { ErrorCode, UserStatus } from '@app/constant';
import { BusinessException } from '@app/types';
import { RedisService, QrSessionStatus } from '@libs/redis';
import { KAFKA_CLIENT } from '@libs/kafka';
import { KafkaTopics } from '@libs/contracts';
import { FirebaseService } from '@libs/firebase';

import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  LogoutDto,
  QrGenerateDto,
  QrConfirmDto,
  QrRejectDto,
} from './dto';
import {
  AuthResponseDto,
  RefreshTokenResponseDto,
  UserResponseDto,
  TokensResponseDto,
  QrSessionResponseDto,
  QrStatusResponseDto,
  QrSessionStatusEnum,
} from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly QR_SESSION_TTL_SECONDS = 300; // 5 minutes

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
    private readonly dataSource: DataSource,
    private readonly firebaseService: FirebaseService,
  ) {}

  private async getFirebaseUserFromToken(firebaseToken: string): Promise<{
    uid: string;
    phone_number?: string;
    email?: string;
    name?: string;
    picture?: string;
  }> {
    const firebaseUser =
      await this.firebaseService.verifyIdToken(firebaseToken);

    if (!firebaseUser.phone_number) {
      throw BusinessException.badRequest(
        'Phone number not found in Firebase token',
      );
    }

    return firebaseUser;
  }
  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    this.logger.log('Registering new user with Firebase token');

    // 1. Verify Firebase ID token
    const firebaseUser = await this.getFirebaseUserFromToken(
      dto.firebaseIdToken,
    );
    this.logger.log(`Firebase user verified: ${firebaseUser.phone_number}`);

    // 2. Check if phone already exists
    const existingUser = await this.userRepository.findOne({
      where: { phone: firebaseUser.phone_number },
    });

    if (existingUser) {
      throw BusinessException.conflict(ErrorCode.USER_PHONE_ALREADY_EXISTS);
    }

    // 3. Check email if provided
    const email = dto.email || firebaseUser.email;
    if (email) {
      const existingEmail = await this.userRepository.findOne({
        where: { email },
      });

      if (existingEmail) {
        throw BusinessException.conflict(ErrorCode.USER_EMAIL_ALREADY_EXISTS);
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // 4. Create user (no password needed - Firebase handles auth)
    const user = this.userRepository.create({
      phone: firebaseUser.phone_number,
      passwordHash,
      fullName: dto.fullName || firebaseUser.name || firebaseUser.phone_number,
      email: email ?? null,
      avatarUrl: firebaseUser.picture ?? null,
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

  /**
   * Reset password with Firebase token verification
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    this.logger.log('Password reset attempt with Firebase token');

    // Verify Firebase ID token
    const firebaseUser = await this.getFirebaseUserFromToken(
      dto.firebaseIdToken,
    );
    this.logger.log(`Firebase user verified: ${firebaseUser.phone_number}`);

    const user = await this.userRepository.findOne({
      where: { phone: firebaseUser.phone_number },
    });

    if (!user) {
      throw BusinessException.badRequest(ErrorCode.AUTH_INVALID_CREDENTIALS);
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
  /**
   * Generate a new QR login session
   * PC calls this to create a QR code for mobile to scan
   */
  async generateQrSession(dto: QrGenerateDto): Promise<QrSessionResponseDto> {
    this.logger.log(`Generating QR session for socket: ${dto.socketId}`);

    const sessionId = uuidv4();
    const qrToken = `qr_${sessionId}_${Date.now()}`;
    const now = Date.now();
    const expiresAt = now + this.QR_SESSION_TTL_SECONDS * 1000;

    await this.redisService.setQrSession({
      sessionId,
      qrToken,
      status: QrSessionStatus.PENDING,
      socketId: dto.socketId,
      pcDeviceInfo: dto.deviceInfo,
      createdAt: now,
      expiresAt,
    });

    this.logger.log(`QR session created: ${sessionId}`);

    return {
      sessionId,
      qrToken,
      expiresAt: new Date(expiresAt),
      expiresInSeconds: this.QR_SESSION_TTL_SECONDS,
    };
  }

  /**
   * Get QR session status
   * PC polls this as fallback when WebSocket fails
   */
  async getQrStatus(sessionId: string): Promise<QrStatusResponseDto> {
    this.logger.debug(`Getting QR status for session: ${sessionId}`);

    const session = await this.redisService.getQrSession(sessionId);

    if (!session) {
      throw BusinessException.notFound(ErrorCode.QR_SESSION_NOT_FOUND);
    }

    // Check if expired (app-level check)
    if (session.expiresAt < Date.now()) {
      throw BusinessException.gone(ErrorCode.QR_SESSION_EXPIRED);
    }

    const response: QrStatusResponseDto = {
      sessionId: session.sessionId,
      status: session.status as unknown as QrSessionStatusEnum,
    };

    // If confirmed, include tokens and user info
    if (session.status === QrSessionStatus.CONFIRMED && session.userId) {
      const user = await this.userRepository.findOne({
        where: { id: session.userId },
      });

      if (user) {
        const tokens = this.jwtService.generateTokenPair(user.id, user.phone);
        response.accessToken = tokens.accessToken;
        response.refreshToken = tokens.refreshToken;
        response.expiresIn = tokens.expiresIn;
        response.user = this.toUserResponse(user);
      }
    }

    return response;
  }

  /**
   * Confirm QR login from mobile
   * Mobile user confirms after scanning QR
   */
  async confirmQrSession(
    userId: string,
    dto: QrConfirmDto,
  ): Promise<{ message: string }> {
    this.logger.log(
      `Confirming QR session: ${dto.sessionId} by user: ${userId}`,
    );

    // 1️⃣ Redis lock (SET NX)
    const result = await this.redisService.confirmQrSession(
      dto.sessionId,
      userId,
    );

    if (!result.success) {
      if (result.alreadyConfirmed) {
        throw BusinessException.conflict(
          ErrorCode.QR_SESSION_ALREADY_PROCESSED,
        );
      }
      throw BusinessException.notFound(ErrorCode.QR_SESSION_NOT_FOUND);
    }

    const session = result.session!;

    try {
      await this.dataSource.transaction(async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: userId },
        });

        if (!user) {
          throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
        }

        const tokens = this.jwtService.generateTokenPair(user.id, user.phone);

        this.kafkaClient.emit(KafkaTopics.AuthQrConfirmed, {
          sessionId: session.sessionId,
          socketId: session.socketId,
          userId: user.id,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: this.toUserResponse(user),
        });
      });

      this.logger.log(
        `QR session confirmed and Kafka event emitted: ${dto.sessionId}`,
      );

      return { message: 'QR login confirmed successfully' };
    } catch (error) {
      throw new BadRequestException(
        'Failed to confirm QR session. Please try again.',
        error,
      );
    }
  }

  /**
   * Reject QR login from mobile
   * Mobile user rejects after scanning QR
   */
  async rejectQrSession(
    userId: string,
    dto: QrRejectDto,
  ): Promise<{ message: string }> {
    this.logger.log(
      `Rejecting QR session: ${dto.sessionId} by user: ${userId}`,
    );

    const session = await this.redisService.rejectQrSession(dto.sessionId);

    if (!session) {
      throw BusinessException.notFound(ErrorCode.QR_SESSION_NOT_FOUND);
    }

    // Emit Kafka event for ws-gateway to notify PC via WebSocket
    this.kafkaClient.emit(KafkaTopics.AuthQrRejected, {
      sessionId: session.sessionId,
      socketId: session.socketId,
      reason: dto.reason || 'User rejected the QR login',
    });

    this.logger.log(
      `QR session rejected and Kafka event emitted: ${dto.sessionId}`,
    );

    return { message: 'QR login rejected' };
  }
}
