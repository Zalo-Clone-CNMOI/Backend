import { Injectable, Logger, Inject } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FIREBASE_APP } from './firebase.tokens';
import { BusinessException } from '@app/types';

export interface DecodedFirebaseToken {
  uid: string;
  phone_number?: string;
  email?: string;
  name?: string;
  picture?: string;
}

// ── FCM Types ────────────────────────────────────────────────────────────

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);

  constructor(
    @Inject(FIREBASE_APP)
    private readonly firebaseApp: admin.app.App,
  ) {}

  /**
   * Verify Firebase ID token and return decoded token
   */
  async verifyIdToken(idToken: string): Promise<DecodedFirebaseToken> {
    try {
      const decodedToken = await this.firebaseApp.auth().verifyIdToken(idToken);

      this.logger.log(`Token verified for UID: ${decodedToken.uid}`);

      return {
        uid: decodedToken.uid,
        phone_number: decodedToken.phone_number,
        email: decodedToken.email,
        name: decodedToken.name as string | undefined,
        picture: decodedToken.picture,
      };
    } catch (error: unknown) {
      this.logger.error('Firebase token verification failed', error);

      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          throw BusinessException.unauthorized('Firebase token has expired');
        }
        if (error.message.includes('invalid')) {
          throw BusinessException.unauthorized('Invalid Firebase token');
        }
      }

      throw BusinessException.unauthorized('Failed to verify Firebase token');
    }
  }

  /**
   * Get user by phone number from Firebase
   */
  async getUserByPhoneNumber(
    phoneNumber: string,
  ): Promise<admin.auth.UserRecord | null> {
    try {
      const user = await this.firebaseApp
        .auth()
        .getUserByPhoneNumber(phoneNumber);
      return user;
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/user-not-found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete user from Firebase
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await this.firebaseApp.auth().deleteUser(uid);
      this.logger.log(`Firebase user deleted: ${uid}`);
    } catch (error) {
      this.logger.error(`Failed to delete Firebase user: ${uid}`, error);
      throw error;
    }
  }
  /**
   * Get the FCM messaging instance
   */
  private get messaging(): admin.messaging.Messaging {
    return this.firebaseApp.messaging();
  }

  /**
   * Send a single push notification to one device token
   */
  async sendToDevice(
    token: string,
    notification: admin.messaging.Notification,
    data?: Record<string, string>,
    options?: Partial<admin.messaging.AndroidConfig>,
  ): Promise<string> {
    const message: admin.messaging.Message = {
      token,
      notification,
      data,
      android: options,
    };
    try {
      const messageId = await this.messaging.send(message);
      this.logger.debug(`FCM message sent: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(
        `FCM sendToDevice failed for token ${token.slice(0, 10)}...`,
        error,
      );
      throw error;
    }
  }

  /**
   * Send push notification to multiple device tokens using sendEach.
   * Returns success/failure counts and invalid tokens for cleanup.
   */
  async sendMulticast(
    tokens: string[],
    notification: admin.messaging.Notification,
    data?: Record<string, string>,
    android?: Partial<admin.messaging.AndroidConfig>,
  ): Promise<FcmSendResult> {
    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification,
      data,
      android,
    }));

    try {
      const response = await this.messaging.sendEach(messages);
      const invalidTokens: string[] = [];

      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          resp.error &&
          (resp.error.code === 'messaging/invalid-registration-token' ||
            resp.error.code === 'messaging/registration-token-not-registered')
        ) {
          invalidTokens.push(tokens[idx]);
        }
      });

      if (invalidTokens.length > 0) {
        this.logger.warn(
          `FCM sendMulticast: ${invalidTokens.length} invalid tokens detected`,
        );
      }

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      this.logger.error('FCM sendMulticast failed', error);
      throw error;
    }
  }

  /**
   * Send to a Firebase topic
   */
  async sendToTopic(
    topic: string,
    notification: admin.messaging.Notification,
    data?: Record<string, string>,
  ): Promise<string> {
    try {
      const messageId = await this.messaging.send({
        topic,
        notification,
        data,
      });
      this.logger.debug(`FCM topic message sent to ${topic}: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(`FCM sendToTopic failed for topic ${topic}`, error);
      throw error;
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(
    tokens: string[],
    topic: string,
  ): Promise<admin.messaging.MessagingTopicManagementResponse> {
    try {
      return await this.messaging.subscribeToTopic(tokens, topic);
    } catch (error) {
      this.logger.error(`FCM subscribeToTopic failed for ${topic}`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(
    tokens: string[],
    topic: string,
  ): Promise<admin.messaging.MessagingTopicManagementResponse> {
    try {
      return await this.messaging.unsubscribeFromTopic(tokens, topic);
    } catch (error) {
      this.logger.error(`FCM unsubscribeFromTopic failed for ${topic}`, error);
      throw error;
    }
  }
}
