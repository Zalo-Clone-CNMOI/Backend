import { DynamicModule, Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FirebaseService } from './firebase.service';
import { FIREBASE_CONFIG, FIREBASE_APP } from './firebase.tokens';
import type { FirebaseConfig } from './firebase.interface';

@Global()
@Module({})
export class FirebaseModule {
  /**
   * Register Firebase module with configuration
   */
  static forRoot(config: FirebaseConfig): DynamicModule {
    const firebaseAppProvider = {
      provide: FIREBASE_APP,
      useFactory: () => {
        // Check if already initialized
        if (admin.apps.length > 0) {
          return admin.app();
        }

        return admin.initializeApp({
          credential: admin.credential.cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey.replace(/\\n/g, '\n'),
          }),
        });
      },
    };

    return {
      module: FirebaseModule,
      providers: [
        {
          provide: FIREBASE_CONFIG,
          useValue: config,
        },
        firebaseAppProvider,
        FirebaseService,
      ],
      exports: [FirebaseService, FIREBASE_APP],
    };
  }

  /**
   * Register Firebase module asynchronously
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<FirebaseConfig> | FirebaseConfig;
    inject?: any[];
  }): DynamicModule {
    const firebaseAppProvider = {
      provide: FIREBASE_APP,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args);

        // Check if already initialized
        if (admin.apps.length > 0) {
          return admin.app();
        }

        return admin.initializeApp({
          credential: admin.credential.cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey.replace(/\\n/g, '\n'),
          }),
        });
      },
      inject: options.inject || [],
    };

    return {
      module: FirebaseModule,
      imports: [ConfigModule],
      providers: [firebaseAppProvider, FirebaseService],
      exports: [FirebaseService, FIREBASE_APP],
    };
  }
}
