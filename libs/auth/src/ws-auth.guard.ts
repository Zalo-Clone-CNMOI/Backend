import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { WsEvents, type WsErrorPayload } from '@libs/contracts';
import { JwtService } from './jwt.service';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

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

    if (!authHeader) {
      this.emitAuthError(client, 'Authentication required');
      return false;
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    try {
      const user = this.jwtService.verifyToken(token);
      if (!user?.userId) {
        this.emitAuthError(client, 'Invalid token');
        return false;
      }
      client.data.userId = user.userId;
      return true;
    } catch (error) {
      this.logger.warn(
        `WS auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.emitAuthError(client, 'Authentication failed');
      return false;
    }
  }

  private emitAuthError(client: AuthedSocket, message: string): void {
    const payload: WsErrorPayload = { code: 'UNAUTHORIZED', message };
    client.emit(WsEvents.WsError, payload);
  }
}
