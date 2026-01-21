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
}
