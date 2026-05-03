import {
  Injectable,
  Inject,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { APP_CONFIG, type AppConfig } from '@libs/config';

export interface IceServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IceServersResult {
  username: string;
  credential: string;
  ttl: number;
  expires_at: number;
  ice_servers: IceServerConfig[];
}

@Injectable()
export class IceServerService {
  private readonly logger = new Logger(IceServerService.name);
  private readonly ttlSeconds = 86400; // 24 h

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  getIceServers(userId: string): IceServersResult {
    const isProduction = process.env.NODE_ENV === 'production';
    const secret = this.config.coturnSecret;
    const host = this.config.coturnHost;

    if (!secret || !host || host === 'localhost') {
      const reason = !secret
        ? 'COTURN_SECRET is not set'
        : !host
          ? 'COTURN_HOST is not set'
          : 'COTURN_HOST is "localhost" (unreachable from remote clients)';

      if (isProduction) {
        this.logger.error(`ICE servers unavailable: ${reason}`);
        throw new InternalServerErrorException('ICE_SERVERS_UNAVAILABLE');
      }

      this.logger.warn(
        `ICE servers degraded (${reason}). Returning empty list — calls will fail across NAT. Set COTURN_SECRET and COTURN_HOST.`,
      );
      return {
        username: '',
        credential: '',
        ttl: 0,
        expires_at: 0,
        ice_servers: [],
      };
    }

    const port = this.config.coturnPort ?? 3478;
    const ttlTimestamp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const username = `${ttlTimestamp}:${userId}`;
    const credential = createHmac('sha1', secret)
      .update(username)
      .digest('base64');

    return {
      username,
      credential,
      ttl: this.ttlSeconds,
      expires_at: ttlTimestamp * 1000,
      ice_servers: [
        { urls: `stun:${host}:${port}` },
        { urls: `turn:${host}:${port}`, username, credential },
        { urls: `turn:${host}:${port}?transport=tcp`, username, credential },
      ],
    };
  }
}
