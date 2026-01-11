import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { JwtService } from './jwt.service';

type SocketData = { userId?: string };
type AuthedSocket = Socket<any, any, any, SocketData>;
@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthedSocket>();
    const authHeader =
      client.handshake.headers['authorization'] ??
      (client.handshake.auth?.token as string | undefined);

    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    const user = this.jwtService.verifyToken(token);
    client.data.userId = user.userId;
    return true;
  }
}
