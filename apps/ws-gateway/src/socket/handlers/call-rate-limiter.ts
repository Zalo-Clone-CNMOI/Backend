import { Injectable } from '@nestjs/common';
import { RedisService } from '@libs/redis';

const START_LIMIT = 5;
const START_WINDOW_S = 30;

// Control events: accept / reject / end / leave.
// Lower limit since these change call state and shouldn't be spammed.
const CONTROL_LIMIT = 30;
const CONTROL_WINDOW_S = 10;

// Signal events: offer / answer / ICE candidate.
// Higher limit because ICE restart bursts (network change, reconnect)
// can produce 20+ candidates in a short window — legitimate traffic
// shouldn't be rate-limited (RC#12).
const SIGNAL_LIMIT = 200;
const SIGNAL_WINDOW_S = 10;

// State requests: passive read. Cap to prevent DOS via spam (RC#12).
const STATE_REQUEST_LIMIT = 30;
const STATE_REQUEST_WINDOW_S = 60;

@Injectable()
export class CallRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async checkStart(userId: string): Promise<number> {
    return this.check(`rate:call:start:${userId}`, START_LIMIT, START_WINDOW_S);
  }

  async checkSignal(userId: string): Promise<number> {
    return this.check(
      `rate:call:signal:${userId}`,
      SIGNAL_LIMIT,
      SIGNAL_WINDOW_S,
    );
  }

  async checkControl(userId: string): Promise<number> {
    return this.check(
      `rate:call:control:${userId}`,
      CONTROL_LIMIT,
      CONTROL_WINDOW_S,
    );
  }

  async checkStateRequest(userId: string): Promise<number> {
    return this.check(
      `rate:call:state:${userId}`,
      STATE_REQUEST_LIMIT,
      STATE_REQUEST_WINDOW_S,
    );
  }

  /**
   * @deprecated Use checkSignal() or checkControl() instead — split for RC#12.
   * Kept for backward compat during phased rollout; remove once all callers updated.
   */
  async checkEvent(userId: string): Promise<number> {
    return this.checkControl(userId);
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
