import { HttpService } from '@nestjs/axios';
import { FactoryProvider } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { Configuration } from '../client/generated';

export interface SsoClientConfig {
  baseUrl: string;
}

export interface SsoClientAsyncConfig {
  useFactory: (...args: any[]) => Promise<SsoClientConfig> | SsoClientConfig;
  inject?: any[];
}

export function injectApiProvider<T>(
  ApiClass: new (
    configuration?: Configuration,
    basePath?: string,
    axios?: AxiosInstance,
  ) => T,
  config: SsoClientConfig,
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
    inject: [HttpService, 'SSO_CLIENT_CONFIG'],
    useFactory: (httpService: HttpService, config: SsoClientConfig) => {
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
