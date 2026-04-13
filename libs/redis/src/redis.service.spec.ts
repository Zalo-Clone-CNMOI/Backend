import { RedisService } from './redis.service';

describe('RedisService auth cache helpers', () => {
  const redisClient = {
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    setEx: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    multi: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  };

  let service: RedisService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RedisService(redisClient as never);
  });

  it('should set auth user cache with default ttl', async () => {
    await service.setAuthUserCache('user-1', { id: 'user-1' });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'auth:user:cache:user-1',
      60,
      JSON.stringify({ id: 'user-1' }),
    );
  });

  it('should parse auth user cache payload', async () => {
    redisClient.get.mockResolvedValueOnce(JSON.stringify({ id: 'user-1' }));

    const result = await service.getAuthUserCache<{ id: string }>('user-1');

    expect(result).toEqual({ id: 'user-1' });
  });

  it('should return null and delete cache key for malformed auth cache payload', async () => {
    redisClient.get.mockResolvedValueOnce('{bad-json');

    const result = await service.getAuthUserCache('user-1');

    expect(result).toBeNull();
    expect(redisClient.del).toHaveBeenCalledWith('auth:user:cache:user-1');
  });

  it('should set and read token revoked-after marker', async () => {
    await service.setTokenRevokedAfter('user-1', 1700000000);
    redisClient.get.mockResolvedValueOnce('1700000000');

    const result = await service.getTokenRevokedAfter('user-1');

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'auth:user:revoked-after:user-1',
      691200,
      '1700000000',
    );
    expect(result).toBe(1700000000);
  });

  it('should return null for malformed token revoked-after value', async () => {
    redisClient.get.mockResolvedValueOnce('not-a-number');

    const result = await service.getTokenRevokedAfter('user-1');

    expect(result).toBeNull();
  });

  it('should proxy redis ping', async () => {
    const result = await service.ping();

    expect(result).toBe('PONG');
    expect(redisClient.ping).toHaveBeenCalled();
  });

  it('should store QR socket binding with expected key ownership and ttl', async () => {
    await service.setQrSocketBinding('bind-token-1', 'socket-owner-1', 90);

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'qr:bind:bind-token-1',
      90,
      'socket-owner-1',
    );
  });

  it('should consume QR socket binding token exactly once', async () => {
    const getMock = jest.fn().mockReturnThis();
    const delMock = jest.fn().mockReturnThis();
    const execMock = jest
      .fn()
      .mockResolvedValueOnce(['socket-owner-1', 1])
      .mockResolvedValueOnce([null, 0]);

    redisClient.multi.mockImplementation(() => ({
      get: getMock,
      del: delMock,
      exec: execMock,
    }));

    const firstConsume = await service.consumeQrSocketBinding('bind-token-1');
    const secondConsume = await service.consumeQrSocketBinding('bind-token-1');

    expect(firstConsume).toBe('socket-owner-1');
    expect(secondConsume).toBeNull();
    expect(getMock).toHaveBeenCalledWith('qr:bind:bind-token-1');
    expect(delMock).toHaveBeenCalledWith('qr:bind:bind-token-1');
  });

  it('should return null when consume transaction fails', async () => {
    const getMock = jest.fn().mockReturnThis();
    const delMock = jest.fn().mockReturnThis();
    const execMock = jest.fn().mockRejectedValue(new Error('redis down'));

    redisClient.multi.mockImplementation(() => ({
      get: getMock,
      del: delMock,
      exec: execMock,
    }));

    await expect(service.consumeQrSocketBinding('bind-token-err')).resolves.toBe(
      null,
    );
  });
});
