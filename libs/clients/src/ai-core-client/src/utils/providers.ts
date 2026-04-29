import { HttpService } from '@nestjs/axios';
import type { FactoryProvider } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { Configuration } from '../client/configuration';

export interface AiCoreClientConfig {
  baseUrl: string;
}

type InjectToken =
  | string
  | symbol
  | (abstract new (...args: never[]) => unknown);

export interface AiCoreClientAsyncConfig {
  useFactory: (
    ...args: unknown[]
  ) => Promise<AiCoreClientConfig> | AiCoreClientConfig;
  inject?: InjectToken[];
}

export function injectApiProvider<T>(
  ApiClass: new (
    configuration?: Configuration,
    basePath?: string,
    axios?: AxiosInstance,
  ) => T,
  config: AiCoreClientConfig,
): FactoryProvider<T> {
  return {
    provide: ApiClass,
    inject: [HttpService],
    useFactory: (httpService: HttpService) => {
      const configuration = new Configuration({ basePath: config.baseUrl });
      return new ApiClass(
        configuration,
        configuration.basePath,
        httpService.axiosRef,
      );
    },
  };
}

export function injectApiProviderAsync<T>(
  ApiClass: new (
    configuration?: Configuration,
    basePath?: string,
    axios?: AxiosInstance,
  ) => T,
): FactoryProvider<T> {
  return {
    provide: ApiClass,
    inject: [HttpService, 'AI_CORE_CLIENT_CONFIG'],
    useFactory: (httpService: HttpService, config: AiCoreClientConfig) => {
      const configuration = new Configuration({ basePath: config.baseUrl });
      return new ApiClass(
        configuration,
        configuration.basePath,
        httpService.axiosRef,
      );
    },
  };
}
