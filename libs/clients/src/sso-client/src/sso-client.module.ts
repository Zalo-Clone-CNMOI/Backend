import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SsoClientService } from './sso-client.service';
import { AuthApi, UsersApi } from './client/generated';
import {
  SsoClientConfig,
  SsoClientAsyncConfig,
  injectApiProviderAsync,
} from './utils/providers';

@Module({})
export class SsoClientModule {
  static register(config: SsoClientConfig): DynamicModule {
    return {
      module: SsoClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'SSO_CLIENT_CONFIG',
          useValue: config,
        },
        injectApiProviderAsync(AuthApi),
        injectApiProviderAsync(UsersApi),
        SsoClientService,
      ],
      exports: [SsoClientService, AuthApi, UsersApi],
    };
  }

  static registerAsync(asyncConfig: SsoClientAsyncConfig): DynamicModule {
    return {
      module: SsoClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'SSO_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        injectApiProviderAsync(AuthApi),
        injectApiProviderAsync(UsersApi),
        SsoClientService,
      ],
      exports: [SsoClientService, AuthApi, UsersApi],
    };
  }
}
