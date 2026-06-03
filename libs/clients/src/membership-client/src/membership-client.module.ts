import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MembershipClientService } from './membership-client.service';
import {
  MembershipClientConfig,
  MembershipClientAsyncConfig,
} from './utils/providers';

@Module({})
export class MembershipClientModule {
  static register(config: MembershipClientConfig): DynamicModule {
    return {
      module: MembershipClientModule,
      global: true,
      imports: [HttpModule],
      providers: [
        {
          provide: 'MEMBERSHIP_CLIENT_CONFIG',
          useValue: config,
        },
        MembershipClientService,
      ],
      exports: [MembershipClientService],
    };
  }

  static registerAsync(
    asyncConfig: MembershipClientAsyncConfig,
  ): DynamicModule {
    return {
      module: MembershipClientModule,
      global: true,
      imports: [HttpModule, ...(asyncConfig.imports ?? [])],
      providers: [
        {
          provide: 'MEMBERSHIP_CLIENT_CONFIG',
          useFactory: asyncConfig.useFactory,
          inject: asyncConfig.inject || [],
        },
        MembershipClientService,
      ],
      exports: [MembershipClientService],
    };
  }
}
