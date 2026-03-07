import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';

/**
 * TokenBudgetService — enforces a global daily token budget per user.
 *
 * Budget tracking uses Redis with daily expiry keys:
 *   ai:budget:{userId}:{YYYYMMDD} -> total tokens consumed
 *
 * Per-feature quotas deferred to v2.
 */
@Injectable()
export class TokenBudgetService {
  private readonly logger = new Logger(TokenBudgetService.name);
  private readonly dailyBudget: number;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.dailyBudget = this.config.aiDailyTokenBudget ?? 1_000_000;
    this.logger.log(`Daily token budget: ${this.dailyBudget.toLocaleString()}`);
  }

  private getKey(userId: string): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `ai:budget:${userId}:${today}`;
  }

  /**
   * Check if user has enough budget for estimated token usage.
   */
  async canConsume(userId: string, estimatedTokens: number): Promise<boolean> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    const currentUsage = used ? parseInt(used, 10) : 0;
    return currentUsage + estimatedTokens <= this.dailyBudget;
  }

  /**
   * Record token consumption after LLM call.
   */
  async consume(userId: string, tokensUsed: number): Promise<number> {
    const key = this.getKey(userId);
    const newTotal = await this.redis.incrBy(key, tokensUsed);

    // Set TTL to expire at end of day (max 24h)
    const ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      await this.redis.expire(key, 86400);
    }

    return newTotal;
  }

  /**
   * Get remaining tokens for user today.
   */
  async getRemaining(userId: string): Promise<number> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    const currentUsage = used ? parseInt(used, 10) : 0;
    return Math.max(0, this.dailyBudget - currentUsage);
  }

  /**
   * Get current usage for user today.
   */
  async getUsage(userId: string): Promise<number> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    return used ? parseInt(used, 10) : 0;
  }
}
