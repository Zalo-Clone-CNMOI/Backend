import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiCoreClientService } from './ai-core-client.service';
import { EntityInfoApi, ModerationApi, ZaiAssistApi } from './client';
import {
  AiCoreClientConfig,
  AiCoreClientAsyncConfig,
  injectApiProvider,
  injectApiProviderAsync,
} from './utils/providers';

@Module({})
export class AiCoreClientModule {
  static register(config: AiCoreClientConfig): DynamicModule {
    return {
      module: AiCoreClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        { provide: 'AI_CORE_CLIENT_CONFIG', useValue: config },
        injectApiProvider(EntityInfoApi, config),
        injectApiProvider(ZaiAssistApi, config),
        injectApiProvider(ModerationApi, config),
        AiCoreClientService,
      ],
      exports: [
        AiCoreClientService,
        EntityInfoApi,
        ZaiAssistApi,
        ModerationApi,
      ],
    };
  }

  static registerAsync(asyncConfig: AiCoreClientAsyncConfig): DynamicModule {
    return {
      module: AiCoreClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'AI_CORE_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        injectApiProviderAsync(EntityInfoApi),
        injectApiProviderAsync(ZaiAssistApi),
        injectApiProviderAsync(ModerationApi),
        AiCoreClientService,
      ],
      exports: [
        AiCoreClientService,
        EntityInfoApi,
        ZaiAssistApi,
        ModerationApi,
      ],
    };
  }
}
