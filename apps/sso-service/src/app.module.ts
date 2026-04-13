import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, AppConfig, ConfigModule } from '@libs/config';
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
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ limit: 5, ttl: seconds(60) }],
        storage: new ThrottlerStorageRedisService(config.redisUrl!),
      }),
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
