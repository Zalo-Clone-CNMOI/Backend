import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { RedisClientType } from 'redis';

export interface DueTimeout {
  callId: string;
  conversationId: string;
}

@Injectable()
export class CallTimeoutService {
  static readonly TIMEOUT_KEY = 'call:ring-timeout:zset';
  static readonly RING_TIMEOUT_MS = 45_000;
  private readonly logger = new Logger(CallTimeoutService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async scheduleTimeout(callId: string, conversationId: string): Promise<void> {
    const fireAt = Date.now() + CallTimeoutService.RING_TIMEOUT_MS;
    await this.redis.zAdd(CallTimeoutService.TIMEOUT_KEY, {
      score: fireAt,
      value: `${callId}:${conversationId}`,
    });
    this.logger.debug(
      `Scheduled timeout for call=${callId} at ${new Date(fireAt).toISOString()}`,
    );
  }

  async cancelTimeout(callId: string, conversationId: string): Promise<void> {
    await this.redis.zRem(
      CallTimeoutService.TIMEOUT_KEY,
      `${callId}:${conversationId}`,
    );
  }

  async pollDueTimeouts(): Promise<DueTimeout[]> {
    const now = Date.now();
    const members = await this.redis.zRangeByScore(
      CallTimeoutService.TIMEOUT_KEY,
      0,
      now,
    );
    return members.flatMap((m) => this.parseEntry(m));
  }

  /**
   * Atomic pop: fetches due entries AND removes them in a single Lua script.
   * Multiple replicas calling this concurrently will each receive a disjoint set
   * of entries, eliminating duplicate timeout processing.
   */
  async popDueTimeouts(): Promise<DueTimeout[]> {
    const now = Date.now();
    const result = (await this.redis.eval(
      `local entries = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1])
       redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
       return entries`,
      {
        keys: [CallTimeoutService.TIMEOUT_KEY],
        arguments: [String(now)],
      },
    )) as string[];

    return (result ?? []).flatMap((m) => this.parseEntry(m));
  }

  private parseEntry(m: string): DueTimeout[] {
    const idx = m.indexOf(':');
    if (idx === -1) {
      this.logger.warn(`Skipping malformed timeout entry: "${m}"`);
      return [];
    }
    return [
      { callId: m.substring(0, idx), conversationId: m.substring(idx + 1) },
    ];
  }
}
