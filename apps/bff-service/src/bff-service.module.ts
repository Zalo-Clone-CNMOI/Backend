import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BffServiceController } from './bff-service.controller';
import { BffServiceService } from './bff-service.service';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { FriendsModule } from './modules/friends';
import { ConversationsModule } from './modules/conversations';
import { SsoClientModule } from '@app/clients';
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
    SsoClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('SSO_SERVICE_URL') ||
          'http://sso-service:5001/api',
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 5, ttl: seconds(60) }],
      storage: new ThrottlerStorageRedisService(
        process.env.REDIS_URL || 'redis://redis:6379',
      ),
    }),
    FriendsModule,
    ConversationsModule,
  ],
  controllers: [BffServiceController],
  providers: [BffServiceService],
})
export class BffServiceModule {}
