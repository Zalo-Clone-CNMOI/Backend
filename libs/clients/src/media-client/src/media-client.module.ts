import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MediaClientService } from './media-client.service';
import { MediaApi } from './client/generated';
import {
  MediaClientConfig,
  MediaClientAsyncConfig,
  injectApiProvider,
  injectApiProviderAsync,
} from './utils/providers';

@Module({})
export class MediaClientModule {
  static register(config: MediaClientConfig): DynamicModule {
    return {
      module: MediaClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'MEDIA_CLIENT_CONFIG',
          useValue: config,
        },
        injectApiProvider(MediaApi, config),
        MediaClientService,
      ],
      exports: [MediaClientService, MediaApi],
    };
  }

  static registerAsync(asyncConfig: MediaClientAsyncConfig): DynamicModule {
    return {
      module: MediaClientModule,
      global: true,
      imports: [HttpModule, ...(asyncConfig.imports ?? [])],
      providers: [
        {
          provide: 'MEDIA_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        injectApiProviderAsync(MediaApi),
        MediaClientService,
      ],
      exports: [MediaClientService, MediaApi],
    };
  }
}
