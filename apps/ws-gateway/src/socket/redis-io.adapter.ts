import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: Parameters<Server['adapter']>[0];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL;

    if (!url) {
      console.warn(
        '[RedisIoAdapter] REDIS_URL is not set - Socket.IO will use in-memory adapter (no Redis pub/sub).',
      );
      return;
    }

    console.log('[RedisIoAdapter] Connecting to Redis at:', url);

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.error('[RedisIoAdapter] Redis pubClient error:', err);
    });

    subClient.on('error', (err) => {
      console.error('[RedisIoAdapter] Redis subClient error:', err);
    });

    try {
      await pubClient.connect();
      console.log('[RedisIoAdapter] pubClient connected');

      await subClient.connect();
      console.log('[RedisIoAdapter] subClient connected');

      this.adapterConstructor = createAdapter(
        pubClient,
        subClient,
      ) as unknown as Parameters<Server['adapter']>[0];

      console.log(
        '[RedisIoAdapter] Redis adapter created (pub/sub will be used for Socket.IO).',
      );
    } catch (err) {
      console.error(
        '[RedisIoAdapter] Failed to connect to Redis - falling back to in-memory adapter.',
        err,
      );
      // If this fails, adapterConstructor will remain undefined
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    console.log(
      '[RedisIoAdapter] createIOServer called. Port:',
      port,
      'Options:',
      options,
    );

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    }) as Server;

    if (this.adapterConstructor) {
      console.log(
        '[RedisIoAdapter] Applying Redis adapter to Socket.IO server.',
      );
      server.adapter(this.adapterConstructor);
    } else {
      console.warn(
        '[RedisIoAdapter] adapterConstructor is NOT set - Socket.IO is running with in-memory adapter (no Redis pub/sub).',
      );
    }

    console.log('[RedisIoAdapter] createIOServer completed.');
    return server;
  }
}