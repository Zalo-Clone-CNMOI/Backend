/**
 * @file token-budget.service.spec.ts
 *
 * Unit tests for TokenBudgetService — Redis-backed daily token quota.
 *
 * Tests: canConsume (within/over budget), consume (TTL set/skip),
 * getRemaining, getUsage.  Uses a plain mock for RedisService.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { TokenBudgetService } from './token-budget.service';
import { APP_CONFIG } from '@libs/config';
import { RedisService } from '@libs/redis';

function makeRedis(overrides: Partial<jest.Mocked<RedisService>> = {}) {
  return {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    incrBy: jest.fn(),
    ttl: jest.fn(),
    expire: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<RedisService>;
}

const DAILY_BUDGET = 50_000;

describe('TokenBudgetService', () => {
  let service: TokenBudgetService;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    redis = makeRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBudgetService,
        {
          provide: APP_CONFIG,
          useValue: { aiDailyTokenBudget: DAILY_BUDGET },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(TokenBudgetService);
  });

  // ── canConsume ────────────────────────────────────────────────────

  describe('canConsume', () => {
    it('returns true when user has used nothing', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.canConsume('user1', 1000);

      expect(result).toBe(true);
    });

    it('returns true when estimated tokens fit within remaining budget', async () => {
      redis.get.mockResolvedValue('10000'); // 10k already used

      const result = await service.canConsume('user1', 5000); // needs 5k more

      expect(result).toBe(true);
    });

    it('returns false when estimated tokens exceed daily budget', async () => {
      redis.get.mockResolvedValue(String(DAILY_BUDGET - 100)); // 100 remaining

      const result = await service.canConsume('user1', 500);

      expect(result).toBe(false);
    });

    it('returns false when budget is exactly at limit', async () => {
      redis.get.mockResolvedValue(String(DAILY_BUDGET));

      const result = await service.canConsume('user1', 1);

      expect(result).toBe(false);
    });

    it('returns true when estimated tokens exactly fill remaining budget', async () => {
      redis.get.mockResolvedValue('0');

      const result = await service.canConsume('user1', DAILY_BUDGET);

      expect(result).toBe(true);
    });

    it('generates the correct Redis key for the user', async () => {
      redis.get.mockResolvedValue(null);

      await service.canConsume('user-abc', 100);

      const calledKey = redis.get.mock.calls[0][0];
      expect(calledKey).toMatch(/^ai:budget:user-abc:\d{8}$/);
    });
  });

  // ── consume ───────────────────────────────────────────────────────

  describe('consume', () => {
    it('increments the budget key and returns new total', async () => {
      redis.incrBy.mockResolvedValue(5000);
      redis.ttl.mockResolvedValue(3600); // TTL already set

      const total = await service.consume('user1', 500);

      expect(redis.incrBy).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:budget:user1:\d{8}$/),
        500,
      );
      expect(total).toBe(5000);
    });

    it('sets 24h TTL when key has no expiry (ttl returns -1)', async () => {
      redis.incrBy.mockResolvedValue(1000);
      redis.ttl.mockResolvedValue(-1); // no TTL
      redis.expire.mockResolvedValue(true as unknown);

      await service.consume('user1', 1000);

      expect(redis.expire).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:budget:user1:\d{8}$/),
        86400,
      );
    });

    it('sets TTL when key does not exist (ttl returns -2)', async () => {
      redis.incrBy.mockResolvedValue(1000);
      redis.ttl.mockResolvedValue(-2); // key does not exist
      redis.expire.mockResolvedValue(true as unknown);

      await service.consume('user1', 1000);

      expect(redis.expire).toHaveBeenCalledWith(expect.anything(), 86400);
    });

    it('does not call expire when TTL is already positive', async () => {
      redis.incrBy.mockResolvedValue(2000);
      redis.ttl.mockResolvedValue(43200); // 12h remaining

      await service.consume('user1', 2000);

      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  // ── getRemaining ──────────────────────────────────────────────────

  describe('getRemaining', () => {
    it('returns full budget when user has no usage', async () => {
      redis.get.mockResolvedValue(null);

      const remaining = await service.getRemaining('user1');

      expect(remaining).toBe(DAILY_BUDGET);
    });

    it('returns correct remaining tokens', async () => {
      redis.get.mockResolvedValue('10000');

      const remaining = await service.getRemaining('user1');

      expect(remaining).toBe(DAILY_BUDGET - 10000);
    });

    it('returns 0 when budget is exhausted', async () => {
      redis.get.mockResolvedValue(String(DAILY_BUDGET));

      const remaining = await service.getRemaining('user1');

      expect(remaining).toBe(0);
    });

    it('returns 0 when usage exceeds budget (no negative values)', async () => {
      redis.get.mockResolvedValue(String(DAILY_BUDGET + 1000));

      const remaining = await service.getRemaining('user1');

      expect(remaining).toBe(0);
    });
  });

  // ── getUsage ──────────────────────────────────────────────────────

  describe('getUsage', () => {
    it('returns 0 when no usage recorded yet', async () => {
      redis.get.mockResolvedValue(null);

      const usage = await service.getUsage('user1');

      expect(usage).toBe(0);
    });

    it('returns current usage amount', async () => {
      redis.get.mockResolvedValue('7500');

      const usage = await service.getUsage('user1');

      expect(usage).toBe(7500);
    });
  });

  // ── default budget ────────────────────────────────────────────────

  describe('default daily budget', () => {
    it('uses 1_000_000 when config does not specify budget', async () => {
      const moduleNoConfig: TestingModule = await Test.createTestingModule({
        providers: [
          TokenBudgetService,
          { provide: APP_CONFIG, useValue: {} },
          {
            provide: RedisService,
            useValue: makeRedis({ get: jest.fn().mockResolvedValue(null) }),
          },
        ],
      }).compile();

      const svcNoConfig = moduleNoConfig.get(TokenBudgetService);

      const canConsume = await svcNoConfig.canConsume('u', 999_999);
      expect(canConsume).toBe(true);

      const canNotConsume = await svcNoConfig.canConsume('u', 1_000_001);
      expect(canNotConsume).toBe(false);
    });
  });
});
