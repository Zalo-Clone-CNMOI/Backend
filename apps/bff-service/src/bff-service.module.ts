import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BffServiceController } from './bff-service.controller';
import { BffServiceService } from './bff-service.service';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { FriendsModule } from './modules/friends';
import { ConversationsModule } from './modules/conversations';
import { MessagesModule } from './modules/messages';
import { DeviceTokensModule } from './modules/device-tokens/device-tokens.module';
import { MediaModule } from './modules/media';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { LoggerModule } from '@libs/logger';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggerModule,
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 5, ttl: seconds(60) }],
      storage: new ThrottlerStorageRedisService(
        process.env.REDIS_URL || 'redis://redis:6379',
      ),
    }),
    AuthModule,
    UsersModule,
    FriendsModule,
    ConversationsModule,
    MessagesModule,
    DeviceTokensModule,
    MediaModule,
  ],
  controllers: [BffServiceController],
  providers: [BffServiceService],
})
export class BffServiceModule {}
