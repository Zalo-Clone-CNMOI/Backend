import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis/src/throttler-storage-redis.service';

import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { DatabaseModule } from '@libs/database';
import { AuthModule as SharedAuthModule, JwtAuthGuard } from '@libs/auth';

import { HealthController } from './health.controller';
import { ConversationsModule } from './modules/conversations';
import { FriendsModule } from './modules/friends';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    SharedAuthModule,
    ConversationsModule,
    FriendsModule,
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 5, ttl: seconds(60) }],
      storage: new ThrottlerStorageRedisService(process.env.REDIS_URL || 'redis://redis:6379'),
    }),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
