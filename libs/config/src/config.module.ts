import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './app-config';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => {
        const serviceName = process.env.SERVICE_NAME ?? 'unknown-service';
        return loadConfig(serviceName);
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
