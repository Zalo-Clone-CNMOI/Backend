import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  APP_CONFIG,
  AppConfig,
  ConfigModule as AppConfigModule,
} from '@libs/config';
import { BffServiceController } from './bff-service.controller';
import { BffServiceService } from './bff-service.service';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { FriendsModule } from './modules/friends';
import { ConversationsModule } from './modules/conversations';
import { MessagesModule } from './modules/messages';
import { DeviceTokensModule } from './modules/device-tokens/device-tokens.module';
import { MediaModule } from './modules/media';
import { EntityInfoModule } from './modules/entity-info';
import { AiAssistModule } from './modules/ai-assist/ai-assist.module';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { LoggerModule } from '@libs/logger';
import { RedisModule } from '@libs/redis';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AppConfigModule,
    LoggerModule,
    RedisModule.forRootAsync(),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ limit: 5, ttl: seconds(60) }],
        storage: new ThrottlerStorageRedisService(config.redisUrl),
      }),
    }),
    AuthModule,
    UsersModule,
    FriendsModule,
    ConversationsModule,
    MessagesModule,
    DeviceTokensModule,
    MediaModule,
    EntityInfoModule,
    AiAssistModule,
  ],
  controllers: [BffServiceController],
  providers: [BffServiceService],
})
export class BffServiceModule {}
