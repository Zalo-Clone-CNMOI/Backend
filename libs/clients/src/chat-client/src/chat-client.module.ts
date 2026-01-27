import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChatClientService } from './chat-client.service';
import { MessagesApi } from './client/generated';
import {
  ChatClientConfig,
  ChatClientAsyncConfig,
  injectApiProvider,
  injectApiProviderAsync,
} from './utils/providers';

@Module({})
export class ChatClientModule {
  static register(config: ChatClientConfig): DynamicModule {
    return {
      module: ChatClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'CHAT_CLIENT_CONFIG',
          useValue: config,
        },
        injectApiProvider(MessagesApi, config),
        ChatClientService,
      ],
      exports: [ChatClientService, MessagesApi],
    };
  }

  static registerAsync(asyncConfig: ChatClientAsyncConfig): DynamicModule {
    return {
      module: ChatClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'CHAT_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        injectApiProviderAsync(MessagesApi),
        ChatClientService,
      ],
      exports: [ChatClientService, MessagesApi],
    };
  }
}
