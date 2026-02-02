import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';
import { loadConfig } from '@libs/config';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: Parameters<Server['adapter']>[0];
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;
  private isRedisConnected = false;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL;

    if (!url) {
      console.warn(
        '[RedisIoAdapter] REDIS_URL is not set - Socket.IO will use in-memory adapter.',
      );
      return;
    }

    console.log('[RedisIoAdapter] Connecting to Redis at:', url);

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.error('[RedisIoAdapter] Redis pubClient error:', err);
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;
    });

    subClient.on('error', (err) => {
      console.error('[RedisIoAdapter] Redis subClient error:', err);
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;
    });

    pubClient.on('connect', () => {
      console.log('[RedisIoAdapter] Redis pubClient connected');
    });

    subClient.on('connect', () => {
      console.log('[RedisIoAdapter] Redis subClient connected');
    });

    try {
      await pubClient.connect();
      await subClient.connect();

      await pubClient.ping();
      await subClient.ping();

      this.pubClient = pubClient;
      this.subClient = subClient;

      const adapter = createAdapter(pubClient, subClient);
      if (!adapter) {
        throw new Error(
          'createAdapter returned null - Redis adapter creation failed',
        );
      }

      this.adapterConstructor = adapter as unknown as Parameters<
        Server['adapter']
      >[0];
      this.isRedisConnected = true;

      console.log(
        '[RedisIoAdapter] Redis adapter created and validated successfully.',
      );
    } catch (err) {
      console.error(
        '[RedisIoAdapter] Failed to connect to Redis - falling back to in-memory adapter.',
        err,
      );
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;

      try {
        await pubClient?.quit();
        await subClient?.quit();
      } catch (cleanupErr) {
        console.error('[RedisIoAdapter] Error during cleanup:', cleanupErr);
      }
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const config = loadConfig(process.env.SERVICE_NAME || 'ws-gateway');

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: config.allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    }) as Server;

    if (this.adapterConstructor && this.isRedisConnected) {
      try {
        server.adapter(this.adapterConstructor);

        server.of('/').adapter.on('error', (err) => {
          console.error('[RedisIoAdapter] Runtime adapter error:', err);
          this.isRedisConnected = false;
          this.adapterConstructor = undefined;
        });

        console.log(
          '[RedisIoAdapter] Redis adapter applied to Socket.IO server.',
        );
      } catch (err) {
        console.error('[RedisIoAdapter] Failed to apply adapter:', err);
        console.warn(
          '[RedisIoAdapter] Socket.IO running with in-memory adapter.',
        );
      }
    } else {
      console.warn(
        '[RedisIoAdapter] Socket.IO running with in-memory adapter.',
      );
    }

    return server;
  }

  getConnectionStatus(): { isRedisConnected: boolean; hasAdapter: boolean } {
    return {
      isRedisConnected: this.isRedisConnected,
      hasAdapter: !!this.adapterConstructor,
    };
  }
}
