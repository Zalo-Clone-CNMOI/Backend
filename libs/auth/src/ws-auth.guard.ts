import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import { JwtService } from './jwt.service';

type SocketData = { userId?: string };
type AuthedSocket = Socket<any, any, any, SocketData>;
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger: Logger;
  constructor(private readonly jwtService: JwtService) {
    this.logger = new Logger(WsAuthGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthedSocket>();
    const authHeader =
      client.handshake.headers['authorization'] ??
      (client.handshake.auth?.token as string | undefined);

    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    try {
      const user = this.jwtService.verifyToken(token);
      if (!user?.userId) return false;
      client.data.userId = user.userId;
      return true;
    } catch (error) {
      this.logger.warn(
        `WS auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
