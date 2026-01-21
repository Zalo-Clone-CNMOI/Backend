import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { User } from '@libs/database/entities';
import { AuthModule as SharedAuthModule } from '@libs/auth';
import { RedisModule } from '@libs/redis';
import { KafkaModule } from '@libs/kafka';
import { FirebaseModule } from '@libs/firebase';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SharedAuthModule,
    RedisModule.forRootAsync(),
    KafkaModule,
    FirebaseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        projectId: configService.getOrThrow<string>('FIREBASE_PROJECT_ID'),
        clientEmail: configService.getOrThrow<string>('FIREBASE_CLIENT_EMAIL'),
        privateKey: configService
          .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
          .replace(/\\n/g, '\n'), // Replace escaped newlines
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
