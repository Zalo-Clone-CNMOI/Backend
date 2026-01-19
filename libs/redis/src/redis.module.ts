import { Module, Global, DynamicModule, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { REDIS_CLIENT } from './redis.tokens';
import { RedisService } from './redis.service';

@Global()
@Module({})
export class RedisModule {
  private static readonly logger = new Logger('RedisModule');

  static forRootAsync(): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_CLIENT,
          inject: [APP_CONFIG],
          useFactory: async (config: AppConfig): Promise<RedisClientType> => {
            const url = config.redisUrl || 'redis://localhost:6379';

            const client = createClient({ url }) as RedisClientType;

            client.on('error', (err) => {
              this.logger.error('Redis Client Error:', err);
            });

            client.on('connect', () => {
              this.logger.log(`Redis connected to ${url}`);
            });

            await client.connect();

            return client;
          },
        },
        RedisService,
      ],
      exports: [REDIS_CLIENT, RedisService],
    };
  }
}
