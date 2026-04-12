import { loadConfig, assertProductionCors } from './app-config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use configured moderation lock TTL when value is valid', () => {
    process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS = '300';

    const config = loadConfig('chat-service');

    expect(config.chatModerationDeleteLockTtlSeconds).toBe(300);
  });

  it('should clamp too-small moderation lock TTL to minimum', () => {
    process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS = '1';

    const config = loadConfig('chat-service');

    expect(config.chatModerationDeleteLockTtlSeconds).toBe(30);
  });

  it('should clamp too-large moderation lock TTL to maximum', () => {
    process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS = '1000';

    const config = loadConfig('chat-service');

    expect(config.chatModerationDeleteLockTtlSeconds).toBe(900);
  });

  it('should fallback to default moderation lock TTL when value is non-finite', () => {
    process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS = 'Infinity';

    const config = loadConfig('chat-service');

    expect(config.chatModerationDeleteLockTtlSeconds).toBe(120);
  });

  it('should throw in production when CORS_ORIGIN is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;

    const config = loadConfig('chat-service');

    expect(() => assertProductionCors(config)).toThrow(
      'CORS_ORIGIN is required in production environment.',
    );
  });

  it('should throw in production when CORS_ORIGIN contains wildcard', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://example.com,*';

    const config = loadConfig('chat-service');

    expect(() => assertProductionCors(config)).toThrow(
      'CORS_ORIGIN cannot contain wildcard (*) in production.',
    );
  });

  it('should allow explicit CORS allow-list in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN =
      'https://app.example.com,https://admin.example.com';

    const config = loadConfig('chat-service');

    expect(() => assertProductionCors(config)).not.toThrow();
    expect(config.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('should not throw when assertProductionCors is called in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGIN;

    const config = loadConfig('chat-service');

    expect(() => assertProductionCors(config)).not.toThrow();
  });
});
