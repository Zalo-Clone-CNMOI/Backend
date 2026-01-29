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

export interface S3ModuleOptions {
  isGlobal?: boolean;
  config: S3Config;
}

export interface S3ModuleAsyncOptions {
  isGlobal?: boolean;
  inject?: any[];
  useFactory: (...args: any[]) => Promise<S3Config> | S3Config;
}
