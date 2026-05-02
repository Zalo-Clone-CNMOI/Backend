import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '@app/decorator';
import type { AuthenticatedUser } from '@app/types';
import { IceServerService } from './services/ice-server.service';

@Controller('calls')
export class IceServerController {
  constructor(private readonly iceServerService: IceServerService) {}

  @Get('ice-servers')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, private')
  getIceServers(@CurrentUser() user: AuthenticatedUser) {
    return this.iceServerService.getIceServers(user.id);
  }
}
