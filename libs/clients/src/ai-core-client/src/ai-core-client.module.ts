import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiCoreClientService } from './ai-core-client.service';
import {
  EntityDetectionsApi,
  EntityInfoApi,
  ModerationApi,
  ZaiAssistApi,
} from './client';
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
        injectApiProvider(EntityDetectionsApi, config),
        AiCoreClientService,
      ],
      exports: [
        AiCoreClientService,
        EntityInfoApi,
        ZaiAssistApi,
        ModerationApi,
        EntityDetectionsApi,
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
        injectApiProviderAsync(EntityDetectionsApi),
        AiCoreClientService,
      ],
      exports: [
        AiCoreClientService,
        EntityInfoApi,
        ZaiAssistApi,
        ModerationApi,
        EntityDetectionsApi,
      ],
    };
  }
}
