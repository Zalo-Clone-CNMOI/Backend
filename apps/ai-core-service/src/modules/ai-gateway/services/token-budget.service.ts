import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';

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

  async canConsume(userId: string, estimatedTokens: number): Promise<boolean> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    const currentUsage = used ? parseInt(used, 10) : 0;
    return currentUsage + estimatedTokens <= this.dailyBudget;
  }

  async consume(userId: string, tokensUsed: number): Promise<number> {
    const key = this.getKey(userId);
    const newTotal = await this.redis.incrBy(key, tokensUsed);

    const ttl = await this.redis.ttl(key);
    if (ttl < 0) {
      await this.redis.expire(key, 86400);
    }

    return newTotal;
  }

  async getRemaining(userId: string): Promise<number> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    const currentUsage = used ? parseInt(used, 10) : 0;
    return Math.max(0, this.dailyBudget - currentUsage);
  }

  async getUsage(userId: string): Promise<number> {
    const key = this.getKey(userId);
    const used = await this.redis.get(key);
    return used ? parseInt(used, 10) : 0;
  }
}
