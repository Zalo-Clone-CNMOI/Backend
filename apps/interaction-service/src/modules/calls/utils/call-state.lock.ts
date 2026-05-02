import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { RedisClientType } from 'redis';

const LOCK_TTL_SECONDS = 5;
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 50;

const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

@Injectable()
export class CallStateLock {
  private readonly logger = new Logger(CallStateLock.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  private getKey(scope: string): string {
    return `call:lock:${scope}`;
  }

  async tryAcquire(
    scope: string,
    ttlSeconds: number = LOCK_TTL_SECONDS,
  ): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(this.getKey(scope), token, {
      NX: true,
      EX: ttlSeconds,
    });
    return result === 'OK' ? token : null;
  }

  async release(scope: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_SCRIPT, {
        keys: [this.getKey(scope)],
        arguments: [token],
      });
    } catch (err) {
      this.logger.warn(
        `Lock release failed scope=${scope}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async withLock<T>(scope: string, fn: () => Promise<T>): Promise<T> {
    let token: string | null = null;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      token = await this.tryAcquire(scope);
      if (token) break;
      await this.sleep(RETRY_DELAY_MS * (attempt + 1));
    }

    if (!token) {
      throw new Error(`Failed to acquire lock for scope=${scope}`);
    }

    try {
      return await fn();
    } finally {
      await this.release(scope, token);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
