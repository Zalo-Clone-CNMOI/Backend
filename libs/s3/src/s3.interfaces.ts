export interface S3Config {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket: string;
  uploadPrefix?: string;
  presignExpiresSeconds?: number;
  accessKeyId?: string;
  secretAccessKey?: string;
}

type InjectToken =
  | string
  | symbol
  | (abstract new (...args: never[]) => unknown);

export interface S3ModuleOptions {
  isGlobal?: boolean;
  config: S3Config;
}

export interface S3ModuleAsyncOptions {
  isGlobal?: boolean;
  inject?: InjectToken[];
  useFactory: (...args: unknown[]) => Promise<S3Config> | S3Config;
}
