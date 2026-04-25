import { Controller, Get } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessToken } from '@app/decorator';
import { IceServerService } from './ice-server.service';

@Controller('calls')
export class IceServerController {
  constructor(
    private readonly iceServerService: IceServerService,
    private readonly jwt: JwtService,
  ) {}

  @Get('ice-servers')
  getIceServers(@AccessToken() token: string) {
    const payload = this.jwt.decode(token) as { sub: string };
    const userId = payload?.sub ?? 'unknown';
    return this.iceServerService.getIceServers(userId);
  }
}
