import { Injectable, Inject } from '@nestjs/common';
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
  ice_servers: IceServerConfig[];
}

@Injectable()
export class IceServerService {
  private readonly ttlSeconds = 86400; // 24 h

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Returns empty ice_servers (and empty username/credential strings) when coturnSecret is not configured. Callers must check ice_servers.length before forwarding credentials to clients. */
  getIceServers(userId: string): IceServersResult {
    const secret = this.config.coturnSecret;
    if (!secret) {
      return { username: '', credential: '', ttl: 0, ice_servers: [] };
    }

    const host = this.config.coturnHost ?? 'localhost';
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
      ice_servers: [
        { urls: `stun:${host}:${port}` },
        { urls: `turn:${host}:${port}`, username, credential },
        { urls: `turn:${host}:${port}?transport=tcp`, username, credential },
      ],
    };
  }
}
