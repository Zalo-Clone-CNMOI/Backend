import { loadConfig } from './app-config';

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
});
