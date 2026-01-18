import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { DatabaseModule } from '@libs/database';
import { AuthModule as SharedAuthModule, JwtAuthGuard } from '@libs/auth';

import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    SharedAuthModule,
    AuthModule,
    UsersModule,
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
