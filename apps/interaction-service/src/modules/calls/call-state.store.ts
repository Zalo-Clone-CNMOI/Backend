import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { CallStateSnapshot } from '@libs/contracts';
import type { RedisClientType } from 'redis';

@Injectable()
export class CallStateStore {
  private readonly logger = new Logger(CallStateStore.name);
  private readonly ttlSeconds = 6 * 60 * 60;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  private getKey(conversationId: string): string {
    return `call:state:conversation:${conversationId}`;
  }

  async get(conversationId: string): Promise<CallStateSnapshot | null> {
    const raw = await this.redis.get(this.getKey(conversationId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CallStateSnapshot;
    } catch (error) {
      this.logger.warn(
        `Invalid call state cache for conversation=${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.clear(conversationId);
      return null;
    }
  }

  async set(conversationId: string, state: CallStateSnapshot): Promise<void> {
    await this.redis.setEx(
      this.getKey(conversationId),
      this.ttlSeconds,
      JSON.stringify(state),
    );
  }

  async clear(conversationId: string): Promise<void> {
    await this.redis.del(this.getKey(conversationId));
  }
}
