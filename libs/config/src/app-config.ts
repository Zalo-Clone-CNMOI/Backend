import { ConversationType } from '@app/constant';

export interface AppConfig {
  nodeEnv: string;
  serviceName: string;

  httpPort?: number;

  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupId?: string;

  scyllaContactPoints: string[];
  scyllaLocalDatacenter: string;
  scyllaKeyspace: string;

  // PostgreSQL configuration
  postgresHost?: string;
  postgresPort?: number;
  postgresUser?: string;
  postgresPassword?: string;
  postgresDatabase?: string;

  redisUrl?: string;

  // Coturn TURN/STUN server configuration
  coturnSecret?: string;
  coturnHost?: string;
  coturnPort?: number;

  // JWT secrets — populated for services with requiresJwt: true
  jwtSecret?: string;
  jwtRefreshSecret?: string;

  // CORS configuration
  allowedOrigins: string[];

  awsRegion?: string;
  s3Bucket?: string;
  s3PresignExpiresSeconds?: number;
  s3UploadPrefix?: string;

  firebaseProjectId?: string;
  firebaseClientEmail?: string;
  firebasePrivateKey?: string;

  // AI Core Service configuration
  openaiApiKey?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  lcdoRouterUrl?: string;
  lcdoRouterKey?: string;
  lcdoRouterModel?: string;
  aiDefaultModel?: string;
  aiEmbeddingModel?: string;
  aiDailyTokenBudget?: number;
  aiEnablePiiSanitization?: boolean;
  aiEnableConversationCache?: boolean;
  aiMaxDocumentSizeMb?: number;
  aiMaxDocumentPages?: number;
  aiStreamBufferSize?: number;
  aiModerationEnsemble?: boolean;
  aiModerationFailOpen?: boolean;

  // Chat Service moderation delete emit lock TTL (seconds)
  chatModerationDeleteLockTtlSeconds?: number;
  chatModerationWarnOnly?: boolean;
  chatModerationEnforceMinConfidence?: number;
  chatModerationHighRiskLabels?: string[];

  // Chat Service pre-send moderation gate (Phase 5)
  /** Master flag — default true. */
  chatPreSendModerationEnabled?: boolean;
  /** Conversation types that skip the gate. Default [DIRECT, AI_ASSISTANT]. */
  chatPreSendModerationSkipConvTypes?: ConversationType[];
  /** Hard timeout (ms) for the HTTP call to ai-core. Caller treats timeout as fail-open. */
  chatPreSendModerationTimeoutMs?: number;
  /** Block threshold — a flagged result below this confidence is treated as ALLOW. */
  chatPreSendModerationConfidenceThreshold?: number;
  /** Clean-result cache TTL (24h default). */
  chatPreSendModerationCacheTtlSeconds?: number;
  /** Block-result cache TTL (15min default) — short so model/threshold changes re-evaluate quickly. */
  chatPreSendModerationBlockCacheTtlSeconds?: number;

  /**
   * Base URL of ai-core-service for synchronous HTTP calls (Phase 5 pre-send
   * moderation gate from chat-service). Defaults to the Docker service name.
   */
  aiCoreServiceUrl?: string;

  // Zai AI bot — fixed user ID seeded by migration
  zaiBotUserId: string;

  // Zai L2 rolling-summary memory (Phase 6 C8) — OFF by default. Stays off in
  // prod until telemetry shows >trigger-turn conversations are common.
  /** Master flag for L2 rolling summary — default false. */
  zaiL2MemoryEnabled?: boolean;
  /** Summarize older turns once total history exceeds this many turns. Default 30. */
  zaiL2SummaryTriggerTurns?: number;
}

interface ServiceConfigRequirements {
  requiresCors: boolean;
  requiresJwt: boolean;
  requiresKafka: boolean;
  requiresKafkaGroupId: boolean;
  requiresRedis: boolean;
  requiresScylla: boolean;
  requiresPostgres: boolean;
}

const DEFAULT_REQUIREMENTS: ServiceConfigRequirements = {
  requiresCors: false,
  requiresJwt: false,
  requiresKafka: false,
  requiresKafkaGroupId: false,
  requiresRedis: false,
  requiresScylla: false,
  requiresPostgres: false,
};

const SERVICE_REQUIREMENTS: Record<string, ServiceConfigRequirements> = {
  'ai-core-service': {
    requiresCors: false,
    requiresJwt: false,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: true,
    requiresPostgres: true,
  },
  'bff-service': {
    requiresCors: true,
    requiresJwt: true,
    requiresKafka: false,
    requiresKafkaGroupId: false,
    requiresRedis: true,
    requiresScylla: false,
    requiresPostgres: false,
  },
  'chat-service': {
    requiresCors: false,
    requiresJwt: false,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: true,
    requiresPostgres: false,
  },
  'interaction-service': {
    requiresCors: true,
    requiresJwt: true,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: false,
    requiresPostgres: true,
  },
  'media-service': {
    requiresCors: true,
    requiresJwt: false,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: false,
    requiresScylla: false,
    requiresPostgres: false,
  },
  'notification-service': {
    requiresCors: false,
    requiresJwt: false,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: false,
    requiresPostgres: false,
  },
  'presence-service': {
    requiresCors: false,
    requiresJwt: false,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: false,
    requiresPostgres: false,
  },
  'sso-service': {
    requiresCors: true,
    requiresJwt: true,
    requiresKafka: true,
    requiresKafkaGroupId: false,
    requiresRedis: true,
    requiresScylla: false,
    requiresPostgres: true,
  },
  'ws-gateway': {
    requiresCors: true,
    requiresJwt: true,
    requiresKafka: true,
    requiresKafkaGroupId: true,
    requiresRedis: true,
    requiresScylla: true,
    requiresPostgres: false,
  },
};

function readNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

function readPositiveInteger(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  const normalized = Math.trunc(parsed);
  return Math.min(Math.max(normalized, min), max);
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readClampedNumber(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.min(Math.max(parsed, min), max);
}

function readCsv(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse a CSV of ConversationType values (case-insensitive) into a typed
 * array. Throws on unknown values to fail loud — silent fallback would
 * defeat the whole point of using the enum (locdx audit concern: silent
 * casing bypass on the skip-list comparison).
 */
function parseConversationTypeCsv(
  value: string | undefined,
  defaultValue: ConversationType[],
): ConversationType[] {
  const raw = readCsv(value);
  if (raw.length === 0) {
    return defaultValue;
  }
  const valid = new Set<string>(Object.values(ConversationType));
  return raw.map((item) => {
    const lower = item.toLowerCase();
    if (!valid.has(lower)) {
      throw new Error(
        `Invalid CHAT_PRE_SEND_MODERATION_SKIP_CONV_TYPES value "${item}". ` +
          `Allowed: ${Array.from(valid).join(', ')}.`,
      );
    }
    return lower as ConversationType;
  });
}

function assertEnvPresent(name: string, value: string | undefined): void {
  if (!value?.trim()) {
    throw new Error(`${name} environment variable is required.`);
  }
}

export function loadConfig(serviceName: string): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const moderationWarnOnlyDefault =
    nodeEnv === 'development' || nodeEnv === 'staging';
  const kafkaBrokers = readCsv(process.env.KAFKA_BROKERS);
  const allowedOrigins = readCsv(process.env.CORS_ORIGIN);

  const config: AppConfig = {
    nodeEnv,
    serviceName,
    httpPort: readNumber(process.env.PORT),

    kafkaBrokers,
    kafkaClientId: process.env.KAFKA_CLIENT_ID?.trim() ?? '',
    kafkaGroupId: process.env.KAFKA_GROUP_ID?.trim(),

    scyllaContactPoints: readCsv(process.env.SCYLLA_CONTACT_POINTS),
    scyllaLocalDatacenter: process.env.SCYLLA_LOCAL_DATACENTER?.trim() ?? '',
    scyllaKeyspace: process.env.SCYLLA_KEYSPACE?.trim() ?? '',

    // PostgreSQL — no defaults; assertServiceConfig enforces required fields
    postgresHost: process.env.DB_HOST?.trim(),
    postgresPort: readNumber(process.env.DB_PORT),
    postgresUser: process.env.DB_USERNAME?.trim(),
    postgresPassword: process.env.DB_PASSWORD?.trim(),
    postgresDatabase: process.env.DB_NAME?.trim(),
    redisUrl: process.env.REDIS_URL?.trim(),

    coturnSecret: process.env.COTURN_SECRET?.trim(),
    coturnHost: process.env.COTURN_HOST?.trim(),
    coturnPort: readPositiveInteger(process.env.COTURN_PORT, 1, 65535),

    jwtSecret: process.env.JWT_SECRET?.trim(),
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET?.trim(),

    // CORS configuration
    allowedOrigins,

    awsRegion: process.env.AWS_REGION,
    s3Bucket: process.env.S3_BUCKET,
    s3PresignExpiresSeconds: readNumber(process.env.S3_PRESIGN_EXPIRES_SECONDS),
    s3UploadPrefix: process.env.S3_UPLOAD_PREFIX,

    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY,

    // AI Core Service
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    lcdoRouterUrl: process.env.LCDO_ROUTER_URL?.trim(),
    lcdoRouterKey: process.env.LCDO_ROUTER_KEY?.trim(),
    lcdoRouterModel: process.env.LCDO_ROUTER_MODEL?.trim(),
    aiDefaultModel: process.env.AI_DEFAULT_MODEL ?? 'gpt-4o-mini',
    aiEmbeddingModel:
      process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    aiDailyTokenBudget:
      readNumber(process.env.AI_DAILY_TOKEN_BUDGET) ?? 1_000_000,
    aiEnablePiiSanitization: process.env.AI_ENABLE_PII_SANITIZATION !== 'false',
    aiEnableConversationCache:
      process.env.AI_ENABLE_CONVERSATION_CACHE !== 'false',
    aiMaxDocumentSizeMb: readNumber(process.env.AI_MAX_DOCUMENT_SIZE_MB) ?? 10,
    aiMaxDocumentPages: readNumber(process.env.AI_MAX_DOCUMENT_PAGES) ?? 200,
    aiStreamBufferSize: readNumber(process.env.AI_STREAM_BUFFER_SIZE) ?? 50,
    aiModerationEnsemble: process.env.AI_MODERATION_ENSEMBLE === 'true',
    aiModerationFailOpen: process.env.AI_MODERATION_FAIL_OPEN === 'true',
    chatModerationDeleteLockTtlSeconds:
      readPositiveInteger(
        process.env.CHAT_MODERATION_DELETE_LOCK_TTL_SECONDS,
        30,
        900,
      ) ?? 120,
    chatModerationWarnOnly:
      readBoolean(process.env.CHAT_MODERATION_WARN_ONLY) ??
      moderationWarnOnlyDefault,
    chatModerationEnforceMinConfidence:
      readClampedNumber(
        process.env.CHAT_MODERATION_ENFORCE_MIN_CONFIDENCE,
        0,
        1,
      ) ?? 0.8,
    chatModerationHighRiskLabels: readCsv(
      process.env.CHAT_MODERATION_HIGH_RISK_LABELS,
    ),
    chatPreSendModerationEnabled:
      readBoolean(process.env.CHAT_PRE_SEND_MODERATION_ENABLED) ?? true,
    chatPreSendModerationSkipConvTypes: parseConversationTypeCsv(
      process.env.CHAT_PRE_SEND_MODERATION_SKIP_CONV_TYPES,
      [ConversationType.DIRECT, ConversationType.AI_ASSISTANT],
    ),
    chatPreSendModerationTimeoutMs:
      readPositiveInteger(
        process.env.CHAT_PRE_SEND_MODERATION_TIMEOUT_MS,
        100,
        30_000,
      ) ?? 2000,
    chatPreSendModerationConfidenceThreshold:
      readClampedNumber(
        process.env.CHAT_PRE_SEND_MODERATION_CONFIDENCE_THRESHOLD,
        0,
        1,
      ) ?? 0.85,
    chatPreSendModerationCacheTtlSeconds:
      readPositiveInteger(
        process.env.CHAT_PRE_SEND_MODERATION_CACHE_TTL_SECONDS,
        60,
        7 * 24 * 3600,
      ) ?? 86400,
    chatPreSendModerationBlockCacheTtlSeconds:
      readPositiveInteger(
        process.env.CHAT_PRE_SEND_MODERATION_BLOCK_CACHE_TTL_SECONDS,
        60,
        24 * 3600,
      ) ?? 900,
    aiCoreServiceUrl:
      process.env.AI_CORE_SERVICE_URL?.trim() ||
      'http://ai-core-service:5005/api',
    zaiBotUserId: (() => {
      const raw =
        process.env.ZAI_BOT_USER_ID?.trim() ||
        '00000000-0000-0000-0000-0000000000a1';
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(raw)) {
        throw new Error(`ZAI_BOT_USER_ID must be a valid UUID (got: ${raw})`);
      }
      return raw;
    })(),
    zaiL2MemoryEnabled:
      readBoolean(process.env.ZAI_L2_MEMORY_ENABLED) ?? false,
    zaiL2SummaryTriggerTurns:
      readPositiveInteger(process.env.ZAI_L2_SUMMARY_TRIGGER_TURNS, 5, 500) ??
      30,
  };

  assertServiceConfig(config);

  return config;
}

function assertServiceConfig(config: AppConfig): void {
  const requirements =
    SERVICE_REQUIREMENTS[config.serviceName] ?? DEFAULT_REQUIREMENTS;

  if (requirements.requiresCors) {
    if (config.allowedOrigins.length === 0) {
      throw new Error('CORS_ORIGIN environment variable is required.');
    }

    if (config.allowedOrigins.includes('*')) {
      throw new Error('CORS_ORIGIN cannot contain wildcard (*).');
    }
  }

  if (requirements.requiresJwt) {
    assertEnvPresent('JWT_SECRET', config.jwtSecret);
    assertEnvPresent('JWT_REFRESH_SECRET', config.jwtRefreshSecret);
  }

  if (requirements.requiresKafka) {
    if (config.kafkaBrokers.length === 0) {
      throw new Error('KAFKA_BROKERS environment variable is required.');
    }

    assertEnvPresent('KAFKA_CLIENT_ID', config.kafkaClientId);

    if (requirements.requiresKafkaGroupId) {
      assertEnvPresent('KAFKA_GROUP_ID', config.kafkaGroupId);
    }
  }

  if (requirements.requiresRedis) {
    assertEnvPresent('REDIS_URL', config.redisUrl);
  }

  if (requirements.requiresScylla) {
    if (config.scyllaContactPoints.length === 0) {
      throw new Error(
        'SCYLLA_CONTACT_POINTS environment variable is required.',
      );
    }

    assertEnvPresent('SCYLLA_LOCAL_DATACENTER', config.scyllaLocalDatacenter);
    assertEnvPresent('SCYLLA_KEYSPACE', config.scyllaKeyspace);
  }

  if (requirements.requiresPostgres) {
    assertEnvPresent('DB_HOST', config.postgresHost);
    assertEnvPresent('DB_PASSWORD', config.postgresPassword);
    assertEnvPresent('DB_NAME', config.postgresDatabase);
  }
}

/**
 * Validates CORS configuration for HTTP-serving services in production.
 * Call this in the bootstrap of any service that exposes HTTP to browsers.
 * Pure Kafka consumers do not need to call this.
 */
export function assertProductionCors(config: AppConfig): void {
  if (config.nodeEnv !== 'production') return;

  if (config.allowedOrigins.length === 0) {
    throw new Error('CORS_ORIGIN is required in production environment.');
  }

  if (config.allowedOrigins.includes('*')) {
    throw new Error('CORS_ORIGIN cannot contain wildcard (*) in production.');
  }
}
