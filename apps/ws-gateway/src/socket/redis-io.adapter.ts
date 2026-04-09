import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';
import { loadConfig } from '@libs/config';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
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
      this.logger.warn(
        '[RedisIoAdapter] REDIS_URL is not set - Socket.IO will use in-memory adapter.',
      );
      return;
    }

    this.logger.log(`[RedisIoAdapter] Connecting to Redis at: ${url}`);

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    pubClient.on('error', (err) => {
      this.logger.error(
        `[RedisIoAdapter] Redis pubClient error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;
    });

    subClient.on('error', (err) => {
      this.logger.error(
        `[RedisIoAdapter] Redis subClient error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;
    });

    pubClient.on('connect', () => {
      this.logger.log('[RedisIoAdapter] Redis pubClient connected');
    });

    subClient.on('connect', () => {
      this.logger.log('[RedisIoAdapter] Redis subClient connected');
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

      this.logger.log(
        '[RedisIoAdapter] Redis adapter created and validated successfully.',
      );
    } catch (err) {
      this.logger.error(
        '[RedisIoAdapter] Failed to connect to Redis - falling back to in-memory adapter.',
        err instanceof Error ? err.stack : String(err),
      );
      this.isRedisConnected = false;
      this.adapterConstructor = undefined;

      try {
        await pubClient?.quit();
        await subClient?.quit();
      } catch (cleanupErr) {
        this.logger.error(
          `[RedisIoAdapter] Error during cleanup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
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
          this.logger.error(
            `[RedisIoAdapter] Runtime adapter error: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.isRedisConnected = false;
          this.adapterConstructor = undefined;
        });

        this.logger.log(
          '[RedisIoAdapter] Redis adapter applied to Socket.IO server.',
        );
      } catch (err) {
        this.logger.error(
          `[RedisIoAdapter] Failed to apply adapter: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.logger.warn(
          '[RedisIoAdapter] Socket.IO running with in-memory adapter.',
        );
      }
    } else {
      this.logger.warn(
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
