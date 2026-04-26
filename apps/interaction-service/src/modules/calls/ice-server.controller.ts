import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@app/decorator';
import type { AuthenticatedUser } from '@app/types';
import { IceServerService } from './services/ice-server.service';

@Controller('calls')
export class IceServerController {
  constructor(private readonly iceServerService: IceServerService) {}

  @Get('ice-servers')
  getIceServers(@CurrentUser() user: AuthenticatedUser) {
    return this.iceServerService.getIceServers(user.id);
  }
}
