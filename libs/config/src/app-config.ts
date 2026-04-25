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
    requiresScylla: false,
    requiresPostgres: false,
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
    coturnPort: readNumber(process.env.COTURN_PORT),

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
