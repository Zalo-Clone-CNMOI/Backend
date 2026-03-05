import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { DatabaseModule } from '@libs/database';
import { AuthModule as SharedAuthModule, JwtAuthGuard } from '@libs/auth';
import { RedisModule } from '@libs/redis';
import { HealthCheckService } from '@libs/shared';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { DeviceTokensModule } from './modules/device-tokens';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis/src/throttler-storage-redis.service';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule.forRootAsync(),
    SharedAuthModule,
    AuthModule,
    UsersModule,
    DeviceTokensModule,
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 5, ttl: seconds(60) }],
      storage: new ThrottlerStorageRedisService(
        process.env.REDIS_URL || 'redis://redis:6379',
      ),
    }),
  ],
  controllers: [HealthController],

  providers: [
    HealthCheckService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
