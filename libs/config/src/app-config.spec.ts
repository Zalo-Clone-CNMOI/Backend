import { loadConfig, assertProductionCors } from './app-config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  const applyChatServiceBaselineEnv = () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'chat-service';
    process.env.KAFKA_GROUP_ID = 'chat-service-group';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.SCYLLA_CONTACT_POINTS = '127.0.0.1';
    process.env.SCYLLA_LOCAL_DATACENTER = 'datacenter1';
    process.env.SCYLLA_KEYSPACE = 'chat';
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS;
    applyChatServiceBaselineEnv();
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

  it('should throw when HTTP service CORS_ORIGIN is missing', () => {
    delete process.env.CORS_ORIGIN;

    expect(() => loadConfig('bff-service')).toThrow(
      'CORS_ORIGIN environment variable is required.',
    );
  });

  it('should throw when CORS_ORIGIN contains wildcard', () => {
    process.env.CORS_ORIGIN = 'https://example.com,*';

    expect(() => loadConfig('bff-service')).toThrow(
      'CORS_ORIGIN cannot contain wildcard (*).',
    );
  });

  it('should allow explicit CORS allow-list', () => {
    process.env.CORS_ORIGIN =
      'https://app.example.com,https://admin.example.com';
    process.env.JWT_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';

    const config = loadConfig('bff-service');

    expect(() => assertProductionCors(config)).not.toThrow();
    expect(config.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('should throw when JWT secrets are missing for jwt-enabled service', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => loadConfig('sso-service')).toThrow(
      'JWT_SECRET environment variable is required.',
    );
  });

  it('should throw when Kafka settings are missing for kafka-enabled service', () => {
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_CLIENT_ID;

    expect(() => loadConfig('chat-service')).toThrow(
      'KAFKA_BROKERS environment variable is required.',
    );
  });

  it('should throw when Redis URL is missing for redis-enabled service', () => {
    delete process.env.REDIS_URL;

    expect(() => loadConfig('chat-service')).toThrow(
      'REDIS_URL environment variable is required.',
    );
  });

  it('should throw when Scylla settings are missing for scylla-enabled service', () => {
    delete process.env.SCYLLA_CONTACT_POINTS;

    expect(() => loadConfig('chat-service')).toThrow(
      'SCYLLA_CONTACT_POINTS environment variable is required.',
    );
  });

  it('should throw when DB_HOST is missing for postgres-enabled service', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.JWT_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    delete process.env.DB_HOST;

    expect(() => loadConfig('sso-service')).toThrow(
      'DB_HOST environment variable is required.',
    );
  });

  it('should throw when DB_PASSWORD is missing for postgres-enabled service', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.JWT_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.DB_HOST = 'db.internal';
    delete process.env.DB_PASSWORD;

    expect(() => loadConfig('sso-service')).toThrow(
      'DB_PASSWORD environment variable is required.',
    );
  });

  it('should throw when DB_NAME is missing for postgres-enabled service', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.JWT_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.DB_HOST = 'db.internal';
    process.env.DB_PASSWORD = 'secret';
    delete process.env.DB_NAME;

    expect(() => loadConfig('sso-service')).toThrow(
      'DB_NAME environment variable is required.',
    );
  });
});
