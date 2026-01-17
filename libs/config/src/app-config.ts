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

  awsRegion?: string;
  s3Bucket?: string;
  s3PresignExpiresSeconds?: number;
  s3UploadPrefix?: string;
}

function readNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

export function loadConfig(serviceName: string): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const kafkaBrokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    serviceName,
    httpPort: readNumber(process.env.PORT),

    kafkaBrokers,
    kafkaClientId: process.env.KAFKA_CLIENT_ID ?? serviceName,
    kafkaGroupId: process.env.KAFKA_GROUP_ID,

    scyllaContactPoints: (process.env.SCYLLA_CONTACT_POINTS ?? '127.0.0.1')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    scyllaLocalDatacenter: process.env.SCYLLA_LOCAL_DATACENTER ?? 'datacenter1',
    scyllaKeyspace: process.env.SCYLLA_KEYSPACE ?? 'chat',

    // PostgreSQL
    postgresHost: process.env.POSTGRES_HOST ?? 'localhost',
    postgresPort: readNumber(process.env.POSTGRES_PORT) ?? 5432,
    postgresUser: process.env.POSTGRES_USER ?? 'postgres',
    postgresPassword: process.env.POSTGRES_PASSWORD ?? 'postgres',
    postgresDatabase: process.env.POSTGRES_DATABASE ?? 'zaloclone',

    redisUrl: process.env.REDIS_URL,

    awsRegion: process.env.AWS_REGION,
    s3Bucket: process.env.S3_BUCKET,
    s3PresignExpiresSeconds: readNumber(process.env.S3_PRESIGN_EXPIRES_SECONDS),
    s3UploadPrefix: process.env.S3_UPLOAD_PREFIX,
  };
}
