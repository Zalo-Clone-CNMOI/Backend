import { DynamicModule, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FriendsApi, ConversationsApi } from './client/generated';
import { InteractionClientService } from './interaction-client.service';
import {
  InteractionClientConfig,
  InteractionClientAsyncConfig,
  injectApiProvider,
  injectApiProviderAsync,
} from './utils/providers';

@Module({})
export class InteractionClientModule {
  static register(config: InteractionClientConfig): DynamicModule {
    return {
      module: InteractionClientModule,
      imports: [HttpModule.register({ timeout: 30000 })],
      providers: [
        injectApiProvider(FriendsApi, config),
        injectApiProvider(ConversationsApi, config),
        InteractionClientService,
      ],
      exports: [InteractionClientService],
    };
  }

  static registerAsync(
    asyncConfig: InteractionClientAsyncConfig,
  ): DynamicModule {
    return {
      module: InteractionClientModule,
      imports: [HttpModule.register({ timeout: 30000 })],
      providers: [
        {
          provide: 'INTERACTION_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        injectApiProviderAsync(FriendsApi),
        injectApiProviderAsync(ConversationsApi),
        InteractionClientService,
      ],
      exports: [InteractionClientService],
    };
  }
}
