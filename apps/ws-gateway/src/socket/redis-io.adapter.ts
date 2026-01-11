import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: Parameters<Server['adapter']>[0];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    await pubClient.connect();
    await subClient.connect();

    this.adapterConstructor = createAdapter(
      pubClient,
      subClient,
    ) as unknown as Parameters<Server['adapter']>[0];
  }

  override createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
