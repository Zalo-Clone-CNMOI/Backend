import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: Parameters<Server['adapter']>[0];
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;
  private isRedisConnected = false;

  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    if (!url.trim()) {
      throw new Error('REDIS_URL is required for ws-gateway Redis adapter.');
    }

    this.logger.log(`[RedisIoAdapter] Connecting to Redis at: ${url}`);

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    pubClient.on('error', (err) => {
      // CRITICAL: cross-pod pub/sub is broken; broadcast events will not reach other pods
      this.logger.error(
        `[RedisIoAdapter] CRITICAL — Redis pubClient error (cross-pod broadcast degraded): ${err instanceof Error ? err.message : String(err)}`,
      );
      this.isRedisConnected = false;
      // Do NOT clear adapterConstructor — the adapter object remains valid and will
      // resume delivering messages automatically once the client reconnects.
    });

    subClient.on('error', (err) => {
      // CRITICAL: cross-pod pub/sub is broken; broadcast events will not reach other pods
      this.logger.error(
        `[RedisIoAdapter] CRITICAL — Redis subClient error (cross-pod broadcast degraded): ${err instanceof Error ? err.message : String(err)}`,
      );
      this.isRedisConnected = false;
      // Do NOT clear adapterConstructor — see pubClient note above.
    });

    pubClient.on('ready', () => {
      this.logger.log(
        '[RedisIoAdapter] Redis pubClient ready — cross-pod broadcast restored',
      );
      this.isRedisConnected = true;
    });

    subClient.on('ready', () => {
      this.logger.log('[RedisIoAdapter] Redis subClient ready');
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
        '[RedisIoAdapter] Failed to connect to Redis.',
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

      throw err;
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    }) as Server;

    if (this.adapterConstructor && this.isRedisConnected) {
      try {
        server.adapter(this.adapterConstructor);

        server.of('/').adapter.on('error', (err) => {
          // CRITICAL: cross-pod pub/sub is degraded until Redis reconnects.
          // Do NOT clear adapterConstructor — the adapter object remains valid
          // and will resume once the underlying Redis clients fire 'ready'.
          this.logger.error(
            `[RedisIoAdapter] CRITICAL — Runtime adapter error (cross-pod broadcast degraded): ${err instanceof Error ? err.message : String(err)}`,
          );
          this.isRedisConnected = false;
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
