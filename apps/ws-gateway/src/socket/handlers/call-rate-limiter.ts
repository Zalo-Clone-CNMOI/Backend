import { Injectable } from '@nestjs/common';
import { RedisService } from '@libs/redis';

const START_LIMIT = 5;
const START_WINDOW_S = 30;

const EVENT_LIMIT = 60;
const EVENT_WINDOW_S = 10;

@Injectable()
export class CallRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async checkStart(userId: string): Promise<number> {
    return this.check(`rate:call:start:${userId}`, START_LIMIT, START_WINDOW_S);
  }

  async checkEvent(userId: string): Promise<number> {
    return this.check(`rate:call:event:${userId}`, EVENT_LIMIT, EVENT_WINDOW_S);
  }

  private async check(
    key: string,
    limit: number,
    windowS: number,
  ): Promise<number> {
    const count = await this.redis.incrBy(key, 1);
    if (count === 1) {
      await this.redis.expire(key, windowS);
    }
    if (count > limit) {
      const remaining = await this.redis.ttl(key);
      return remaining > 0 ? remaining : windowS;
    }
    return 0;
  }
}
