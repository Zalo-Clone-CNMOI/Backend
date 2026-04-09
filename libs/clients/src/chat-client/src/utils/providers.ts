import { HttpService } from '@nestjs/axios';
import { FactoryProvider } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { Configuration } from '../client/generated';

export interface ChatClientConfig {
  baseUrl: string;
}

type InjectToken =
  | string
  | symbol
  | (abstract new (...args: never[]) => unknown);

export interface ChatClientAsyncConfig {
  useFactory: (
    ...args: unknown[]
  ) => Promise<ChatClientConfig> | ChatClientConfig;
  inject?: InjectToken[];
}

export function injectApiProvider<T>(
  ApiClass: new (
    configuration?: Configuration,
    basePath?: string,
    axios?: AxiosInstance,
  ) => T,
  config: ChatClientConfig,
): FactoryProvider<T> {
  return {
    provide: ApiClass,
    inject: [HttpService],
    useFactory: (httpService: HttpService) => {
      const configuration = new Configuration({
        basePath: config.baseUrl,
      });

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
    inject: [HttpService, 'CHAT_CLIENT_CONFIG'],
    useFactory: (httpService: HttpService, config: ChatClientConfig) => {
      const configuration = new Configuration({
        basePath: config.baseUrl,
      });

      return new ApiClass(
        configuration,
        configuration.basePath,
        httpService.axiosRef,
      );
    },
  };
}
