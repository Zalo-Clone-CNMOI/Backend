/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test } from '@nestjs/testing';
import { CallTimeoutService } from '../services/call-timeout.service';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';

describe('CallTimeoutService', () => {
  let service: CallTimeoutService;
  let redis: any;

  beforeEach(async () => {
    redis = {
      zAdd: jest.fn().mockResolvedValue(1),
      zRem: jest.fn().mockResolvedValue(1),
      zRangeByScore: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        CallTimeoutService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get(CallTimeoutService);
  });

  afterEach(() => jest.clearAllMocks());

  it('scheduleTimeout adds member to Redis sorted set with correct score', async () => {
    const now = Date.now();
    await service.scheduleTimeout('call-1', 'conv-1');
    expect(redis.zAdd).toHaveBeenCalledWith(
      CallTimeoutService.TIMEOUT_KEY,
      expect.objectContaining({
        score: expect.any(Number),
        value: 'call-1:conv-1',
      }),
    );
    const call = redis.zAdd.mock.calls[0] as [
      string,
      { score: number; value: string },
    ];
    const score = call[1].score;
    expect(score).toBeGreaterThanOrEqual(
      now + CallTimeoutService.RING_TIMEOUT_MS,
    );
    expect(score).toBeLessThan(now + CallTimeoutService.RING_TIMEOUT_MS + 1000);
  });

  it('cancelTimeout removes member from sorted set', async () => {
    await service.cancelTimeout('call-1', 'conv-1');
    expect(redis.zRem).toHaveBeenCalledWith(
      CallTimeoutService.TIMEOUT_KEY,
      'call-1:conv-1',
    );
  });

  it('pollDueTimeouts returns empty array when nothing is due', async () => {
    redis.zRangeByScore.mockResolvedValue([]);
    const due = await service.pollDueTimeouts();
    expect(due).toEqual([]);
  });

  it('pollDueTimeouts returns parsed entries that are overdue', async () => {
    redis.zRangeByScore.mockResolvedValue(['call-2:conv-2', 'call-3:conv-3']);
    const due = await service.pollDueTimeouts();
    expect(due).toEqual([
      { callId: 'call-2', conversationId: 'conv-2' },
      { callId: 'call-3', conversationId: 'conv-3' },
    ]);
  });

  it('pollDueTimeouts calls zRangeByScore with score range 0 to now', async () => {
    const now = Date.now();
    await service.pollDueTimeouts();
    const call = redis.zRangeByScore.mock.calls[0] as [string, number, number];
    expect(call[0]).toBe(CallTimeoutService.TIMEOUT_KEY);
    expect(call[1]).toBe(0);
    expect(call[2]).toBeGreaterThanOrEqual(now);
    expect(call[2]).toBeLessThanOrEqual(now + 100);
  });

  it('pollDueTimeouts skips malformed entries with no colon separator', async () => {
    redis.zRangeByScore.mockResolvedValue(['malformed', 'call-4:conv-4']);
    const due = await service.pollDueTimeouts();
    expect(due).toEqual([{ callId: 'call-4', conversationId: 'conv-4' }]);
  });
});
