import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from './jwt.service';
import { WsAuthGuard } from './ws-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from '@libs/database';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [JwtService, WsAuthGuard, JwtAuthGuard],
  exports: [JwtService, WsAuthGuard, JwtAuthGuard],
})
export class AuthModule {}
