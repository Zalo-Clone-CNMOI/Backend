import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

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
        '[RedisIoAdapter] REDIS_URL is not set - Socket.IO will use in-memory adapter (no Redis pub/sub).',
      );
      return;
    }

    console.log('[RedisIoAdapter] Connecting to Redis at:', url);

    const pubClient: RedisClientType = createClient({ url });
    const subClient: RedisClientType = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.error('[RedisIoAdapter] ❌ Redis pubClient error:', err);
      this.isRedisConnected = false;
    });

    subClient.on('error', (err) => {
      console.error('[RedisIoAdapter] ❌ Redis subClient error:', err);
      this.isRedisConnected = false;
    });

    pubClient.on('connect', () => {
      console.log('[RedisIoAdapter] ✅ pubClient connected');
    });

    subClient.on('connect', () => {
      console.log('[RedisIoAdapter] ✅ subClient connected');
    });

    pubClient.on('reconnecting', () => {
      console.warn('[RedisIoAdapter] ⚠️ pubClient reconnecting...');
    });

    subClient.on('reconnecting', () => {
      console.warn('[RedisIoAdapter] ⚠️ subClient reconnecting...');
    });

    try {
      await pubClient.connect();
      console.log('[RedisIoAdapter] pubClient.connect() completed');

      await subClient.connect();
      console.log('[RedisIoAdapter] subClient.connect() completed');

      await pubClient.ping();
      console.log('[RedisIoAdapter] ✅ pubClient PING successful');

      await subClient.ping();
      console.log('[RedisIoAdapter] ✅ subClient PING successful');

      this.pubClient = pubClient;
      this.subClient = subClient;

      this.adapterConstructor = createAdapter(
        pubClient,
        subClient,
      ) as unknown as Parameters<Server['adapter']>[0];

      this.isRedisConnected = true;

      console.log(
        '[RedisIoAdapter] ✅ Redis adapter constructor created successfully.',
      );
      console.log(
        '[RedisIoAdapter] 📡 Redis pub/sub will be used for Socket.IO cross-instance communication.',
      );
    } catch (err) {
      console.error(
        '[RedisIoAdapter] ❌ CRITICAL: Failed to connect to Redis - falling back to in-memory adapter.',
        err,
      );
      console.error(
        '[RedisIoAdapter] ⚠️ This means Socket.IO will NOT work across multiple instances!',
      );
      this.isRedisConnected = false;
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    console.log(
      '[RedisIoAdapter] 🔧 createIOServer called. Port:',
      port,
      'Redis Connected:',
      this.isRedisConnected,
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

    if (this.adapterConstructor && this.isRedisConnected) {
      console.log(
        '[RedisIoAdapter] ✅ Applying Redis adapter to Socket.IO server.',
      );
      server.adapter(this.adapterConstructor);

      console.log(
        '[RedisIoAdapter] 📊 Adapter attached:',
        typeof server.adapter,
      );
      console.log(
        '[RedisIoAdapter] 📊 Adapter name:',
        server.adapter?.constructor?.name,
      );

      setTimeout(() => {
        void this.testRedisPubSub();
      }, 2000);
    } else {
      console.error(
        '[RedisIoAdapter] ❌ CRITICAL: adapterConstructor is NOT set or Redis not connected.',
      );
      console.error(
        '[RedisIoAdapter] ❌ Socket.IO is running with IN-MEMORY adapter (no Redis pub/sub).',
      );
      console.error(
        '[RedisIoAdapter] ⚠️ This WILL cause issues in Docker/multi-instance deployment!',
      );
    }

    console.log('[RedisIoAdapter] createIOServer completed.');
    return server;
  }

  private async testRedisPubSub(): Promise<void> {
    if (!this.pubClient || !this.subClient) {
      console.warn(
        '[RedisIoAdapter] Cannot test pub/sub - clients not initialized',
      );
      return;
    }

    try {
      console.log('[RedisIoAdapter] 🧪 Testing Redis pub/sub...');

      const testChannel = 'test:redis:adapter';
      const testMessage = JSON.stringify({ test: true, timestamp: Date.now() });

      await this.subClient.subscribe(testChannel, (message) => {
        console.log(
          '[RedisIoAdapter] ✅ Test pub/sub successful! Received:',
          message,
        );
      });

      await this.pubClient.publish(testChannel, testMessage);

      setTimeout(() => {
        void this.subClient?.unsubscribe(testChannel).then(() => {
          console.log('[RedisIoAdapter] 🧪 Test pub/sub completed.');
        });
      }, 1000);
    } catch (err) {
      console.error('[RedisIoAdapter] ❌ Test pub/sub failed:', err);
    }
  }

  getConnectionStatus(): { isRedisConnected: boolean; hasAdapter: boolean } {
    return {
      isRedisConnected: this.isRedisConnected,
      hasAdapter: !!this.adapterConstructor,
    };
  }
}
