import { Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { WsAuthGuard } from './ws-auth.guard';

@Module({
  providers: [JwtService, WsAuthGuard],
  exports: [JwtService, WsAuthGuard],
})
export class AuthModule {}
