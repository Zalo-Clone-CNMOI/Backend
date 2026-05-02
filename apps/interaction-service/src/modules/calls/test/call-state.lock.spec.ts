import { Test } from '@nestjs/testing';
import { CallStateLock } from '../utils/call-state.lock';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';

describe('CallStateLock', () => {
  let lock: CallStateLock;
  const redis = {
    set: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [CallStateLock, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();
    lock = module.get(CallStateLock);
  });

  it('acquires when SET NX returns OK', async () => {
    redis.set.mockResolvedValueOnce('OK');
    const token = await lock.tryAcquire('conv-1');
    expect(token).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      'call:lock:conv-1',
      expect.any(String),
      expect.objectContaining({ NX: true, EX: 5 }),
    );
  });

  it('returns null when SET NX returns null (lock held)', async () => {
    redis.set.mockResolvedValueOnce(null);
    const token = await lock.tryAcquire('conv-1');
    expect(token).toBeNull();
  });

  it('release runs Lua compare-and-delete with token', async () => {
    await lock.release('conv-1', 'token-abc');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      expect.objectContaining({
        keys: ['call:lock:conv-1'],
        arguments: ['token-abc'],
      }),
    );
  });

  it('withLock acquires, runs fn, releases on success', async () => {
    redis.set.mockResolvedValueOnce('OK');
    const fn = jest.fn().mockResolvedValue('result');
    const result = await lock.withLock('conv-1', fn);
    expect(result).toBe('result');
    expect(fn).toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalled();
  });

  it('withLock releases lock even if fn throws', async () => {
    redis.set.mockResolvedValueOnce('OK');
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(lock.withLock('conv-1', fn)).rejects.toThrow('boom');
    expect(redis.eval).toHaveBeenCalled();
  });

  it('withLock retries when lock is held, eventually fails', async () => {
    redis.set.mockResolvedValue(null); // always held
    const fn = jest.fn();
    await expect(lock.withLock('conv-1', fn)).rejects.toThrow(
      /Failed to acquire lock/,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(5); // RETRY_ATTEMPTS
  });
});
