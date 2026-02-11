import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FirebaseService } from '@libs/firebase';
import { DeviceToken } from '@libs/database';
import {
  type INotificationProvider,
  type SendNotificationInput,
  type SendNotificationResult,
} from '../notification.provider';
import { NotificationMetrics } from '../../services/notification.metrics';

@Injectable()
export class FcmNotificationProvider implements INotificationProvider {
  private readonly logger = new Logger(FcmNotificationProvider.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepo: Repository<DeviceToken>,
    private readonly metrics: NotificationMetrics,
  ) {}

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const tokens = await this.getActiveTokens(input.userId);

    if (tokens.length === 0) {
      this.logger.debug(`No active device tokens for user ${input.userId}`);
      this.metrics.recordNoTokens();
      return { ok: true, successCount: 0, failureCount: 0 };
    }

    const tokenStrings = tokens.map((t) => t.token);

    try {
      const result = await this.firebaseService.sendMulticast(
        tokenStrings,
        { title: input.title, body: input.body, imageUrl: input.imageUrl },
        input.data,
        input.priority === 'high' ? { priority: 'high' as const } : undefined,
      );

      if (result.failureCount === 0) {
        this.logger.debug(
          `FCM notification sent successfully to user ${input.userId}: ${result.successCount} success`,
        );
      }
      // Deactivate invalid tokens
      if (result.invalidTokens.length > 0) {
        await this.deactivateTokens(result.invalidTokens);
        this.metrics.recordInvalidTokens(result.invalidTokens.length);
      }

      this.metrics.recordSent(result.successCount);
      if (result.failureCount > 0) {
        this.metrics.recordFailed(result.failureCount);
      }

      return {
        ok: result.successCount > 0,
        successCount: result.successCount,
        failureCount: result.failureCount,
      };
    } catch (error) {
      this.logger.error(
        `FCM send failed for user ${input.userId}`,
        error instanceof Error ? error.stack : error,
      );
      this.metrics.recordFailed(tokens.length);
      return { ok: false, successCount: 0, failureCount: tokens.length };
    }
  }

  private async getActiveTokens(userId: string): Promise<DeviceToken[]> {
    return this.deviceTokenRepo.find({
      where: { userId, isActive: true },
    });
  }

  private async deactivateTokens(tokenStrings: string[]): Promise<void> {
    try {
      await this.deviceTokenRepo.update(
        { token: In(tokenStrings) },
        { isActive: false },
      );
      this.logger.warn(`Deactivated ${tokenStrings.length} invalid FCM tokens`);
    } catch (error) {
      this.logger.error('Failed to deactivate invalid tokens', error);
    }
  }
}
