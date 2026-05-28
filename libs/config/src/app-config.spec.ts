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
    process.env.NODE_ENV = 'test';
    delete process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS;
    delete process.env.CHAT_MODERATION_WARN_ONLY;
    delete process.env.CHAT_MODERATION_ENFORCE_MIN_CONFIDENCE;
    delete process.env.CHAT_MODERATION_HIGH_RISK_LABELS;
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

  it('should enable moderation warn-only by default in development', () => {
    process.env.NODE_ENV = 'development';

    const config = loadConfig('chat-service');

    expect(config.chatModerationWarnOnly).toBe(true);
  });

  it('should enable moderation warn-only by default in staging', () => {
    process.env.NODE_ENV = 'staging';

    const config = loadConfig('chat-service');

    expect(config.chatModerationWarnOnly).toBe(true);
  });

  it('should disable moderation warn-only by default in production', () => {
    process.env.NODE_ENV = 'production';

    const config = loadConfig('chat-service');

    expect(config.chatModerationWarnOnly).toBe(false);
  });

  it('should honor explicit moderation warn-only override in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.CHAT_MODERATION_WARN_ONLY = 'false';

    const config = loadConfig('chat-service');

    expect(config.chatModerationWarnOnly).toBe(false);
  });

  it('should clamp moderation confidence threshold to [0, 1]', () => {
    process.env.CHAT_MODERATION_ENFORCE_MIN_CONFIDENCE = '1.5';

    const highConfig = loadConfig('chat-service');
    expect(highConfig.chatModerationEnforceMinConfidence).toBe(1);

    process.env.CHAT_MODERATION_ENFORCE_MIN_CONFIDENCE = '-0.2';
    const lowConfig = loadConfig('chat-service');
    expect(lowConfig.chatModerationEnforceMinConfidence).toBe(0);
  });

  it('should parse moderation high-risk labels from CSV', () => {
    process.env.CHAT_MODERATION_HIGH_RISK_LABELS = 'spam,toxic,violence';

    const config = loadConfig('chat-service');

    expect(config.chatModerationHighRiskLabels).toEqual([
      'spam',
      'toxic',
      'violence',
    ]);
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

describe('Zai bot configuration', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads ZAI_BOT_USER_ID from environment', () => {
    process.env.ZAI_BOT_USER_ID = '11111111-2222-3333-4444-555555555555';
    process.env.NODE_ENV = 'production';
    // satisfy minimum config requirements; reuse helpers from existing tests
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'test';
    process.env.KAFKA_GROUP_ID = 'test-group';
    process.env.REDIS_URL = 'redis://localhost';
    process.env.SCYLLA_CONTACT_POINTS = 'localhost';
    process.env.SCYLLA_LOCAL_DATACENTER = 'dc1';
    process.env.SCYLLA_KEYSPACE = 'test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USERNAME = 'u';
    process.env.DB_PASSWORD = 'p';
    process.env.DB_NAME = 'd';

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m1 = require('./app-config') as typeof import('./app-config');
    const config = m1.loadConfig('chat-service');
    expect(config.zaiBotUserId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('uses dev default UUID when ZAI_BOT_USER_ID unset in development', () => {
    delete process.env.ZAI_BOT_USER_ID;
    process.env.NODE_ENV = 'development';
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'test';
    process.env.KAFKA_GROUP_ID = 'test-group';
    process.env.REDIS_URL = 'redis://localhost';
    process.env.SCYLLA_CONTACT_POINTS = 'localhost';
    process.env.SCYLLA_LOCAL_DATACENTER = 'dc1';
    process.env.SCYLLA_KEYSPACE = 'test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USERNAME = 'u';
    process.env.DB_PASSWORD = 'p';
    process.env.DB_NAME = 'd';

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m2 = require('./app-config') as typeof import('./app-config');
    const config = m2.loadConfig('chat-service');
    expect(config.zaiBotUserId).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('rejects invalid UUID format', () => {
    process.env.ZAI_BOT_USER_ID = 'not-a-uuid';
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'test';
    process.env.KAFKA_GROUP_ID = 'test-group';
    process.env.REDIS_URL = 'redis://localhost';
    process.env.SCYLLA_CONTACT_POINTS = 'localhost';
    process.env.SCYLLA_LOCAL_DATACENTER = 'dc1';
    process.env.SCYLLA_KEYSPACE = 'test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USERNAME = 'u';
    process.env.DB_PASSWORD = 'p';
    process.env.DB_NAME = 'd';

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m3 = require('./app-config') as typeof import('./app-config');
    expect(() => m3.loadConfig('chat-service')).toThrow(/ZAI_BOT_USER_ID/);
  });
});
