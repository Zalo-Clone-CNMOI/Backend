import { Module, DynamicModule, Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT, S3_CONFIG } from './s3.tokens';
import { S3Service } from './s3.service';
import type {
  S3ModuleOptions,
  S3ModuleAsyncOptions,
  S3Config,
} from './s3.interfaces';

@Module({})
export class S3Module {
  private static readonly logger = new Logger('S3Module');

  /**
   * Register S3 module with synchronous configuration
   */
  static forRoot(options: S3ModuleOptions): DynamicModule {
    const { isGlobal = false, config } = options;

    return {
      global: isGlobal,
      module: S3Module,
      providers: [
        {
          provide: S3_CONFIG,
          useValue: config,
        },
        {
          provide: S3_CLIENT,
          useFactory: () => {
            const s3Client = new S3Client({
              region: config.region ?? 'ap-southeast-1',
              endpoint: config.endpoint,
              forcePathStyle: config.forcePathStyle ?? false,
              credentials: config.accessKeyId
                ? {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey!,
                  }
                : undefined,
            });

            this.logger.log(
              `S3 client initialized for bucket: ${config.bucket}`,
            );

            return s3Client;
          },
        },
        S3Service,
      ],
      exports: [S3_CLIENT, S3_CONFIG, S3Service],
    };
  }

  /**
   * Register S3 module with asynchronous configuration
   */
  static forRootAsync(options: S3ModuleAsyncOptions): DynamicModule {
    const { isGlobal = false, inject = [], useFactory } = options;

    const configProvider = {
      provide: S3_CONFIG,
      inject,
      useFactory,
    };

    const clientProvider = {
      provide: S3_CLIENT,
      inject: [S3_CONFIG],
      useFactory: (config: S3Config) => {
        return new S3Client({
          region: config.region ?? 'ap-southeast-1',
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle ?? false,
          credentials: config.accessKeyId
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey!,
              }
            : undefined,
        });
      },
    };

    return {
      global: isGlobal,
      module: S3Module,
      providers: [configProvider, clientProvider, S3Service],
      exports: [S3_CLIENT, S3_CONFIG, S3Service],
    };
  }
}
