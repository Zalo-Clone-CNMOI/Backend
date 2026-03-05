import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeviceToken } from '@libs/database/entities';
import { RegisterDeviceTokenDto, DeviceTokenResponseDto } from './dto';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepository: Repository<DeviceToken>,
  ) {}

  /**
   * Register or update a device token for a user
   * If token already exists, update its platform and device_id
   */
  async registerToken(
    userId: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    this.logger.debug(
      `Registering device token for user ${userId}, platform: ${dto.platform}`,
    );

    // Check if token already exists for this user
    let deviceToken = await this.deviceTokenRepository.findOne({
      where: { userId, token: dto.token },
    });

    if (deviceToken) {
      // Update existing token
      deviceToken.platform = dto.platform;
      deviceToken.deviceId = dto.deviceId ?? null;
      deviceToken.isActive = true;
      deviceToken.updatedAt = new Date();
    } else {
      // Create new token
      deviceToken = this.deviceTokenRepository.create({
        userId,
        token: dto.token,
        platform: dto.platform,
        deviceId: dto.deviceId ?? null,
        isActive: true,
      });
    }

    const saved = await this.deviceTokenRepository.save(deviceToken);

    return this.toResponseDto(saved);
  }

  /**
   * Get all device tokens for a user
   */
  async getUserTokens(userId: string): Promise<DeviceTokenResponseDto[]> {
    const tokens = await this.deviceTokenRepository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    return tokens.map((token) => this.toResponseDto(token));
  }

  /**
   * Delete a specific device token
   */
  async deleteToken(
    userId: string,
    tokenId: string,
  ): Promise<{ success: boolean }> {
    this.logger.debug(`Deleting device token ${tokenId} for user ${userId}`);

    const token = await this.deviceTokenRepository.findOne({
      where: { id: tokenId, userId },
    });

    if (!token) {
      throw new NotFoundException('Device token not found');
    }

    await this.deviceTokenRepository.remove(token);

    return { success: true };
  }

  /**
   * Delete all device tokens for a user
   */
  async deleteAllUserTokens(userId: string): Promise<{ count: number }> {
    this.logger.debug(`Deleting all device tokens for user ${userId}`);

    const result = await this.deviceTokenRepository.delete({ userId });

    return { count: result.affected ?? 0 };
  }

  /**
   * Mark a device token as inactive (soft delete)
   */
  async deactivateToken(
    userId: string,
    tokenId: string,
  ): Promise<DeviceTokenResponseDto> {
    const token = await this.deviceTokenRepository.findOne({
      where: { id: tokenId, userId },
    });

    if (!token) {
      throw new NotFoundException('Device token not found');
    }

    token.isActive = false;
    token.updatedAt = new Date();

    const updated = await this.deviceTokenRepository.save(token);

    return this.toResponseDto(updated);
  }

  /**
   * Get active device tokens for a user (used by notification-service)
   */
  async getActiveTokensForUser(userId: string): Promise<string[]> {
    const tokens = await this.deviceTokenRepository.find({
      where: { userId, isActive: true },
      select: ['token'],
    });

    return tokens.map((t) => t.token);
  }

  /**
   * Get active device tokens for multiple users (batch query)
   */
  async getActiveTokensForUsers(userIds: string[]): Promise<DeviceToken[]> {
    const tokens = await this.deviceTokenRepository.find({
      where: { userId: In(userIds), isActive: true },
      select: ['userId', 'token'],
    });

    return tokens;
  }

  private toResponseDto(token: DeviceToken): DeviceTokenResponseDto {
    return {
      id: token.id,
      token: token.token,
      platform: token.platform,
      deviceId: token.deviceId,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }
}
