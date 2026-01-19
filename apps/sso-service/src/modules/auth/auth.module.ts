import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@libs/database/entities';
import { AuthModule as SharedAuthModule } from '@libs/auth';
import { RedisModule } from '@libs/redis';
import { KafkaModule } from '@libs/kafka';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SharedAuthModule,
    RedisModule.forRootAsync(),
    KafkaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
