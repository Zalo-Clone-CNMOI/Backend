import { ModuleMetadata } from '@nestjs/common/interfaces';

export interface MembershipClientConfig {
  baseUrl: string;
}

type InjectToken =
  | string
  | symbol
  | (abstract new (...args: never[]) => unknown);

export interface MembershipClientAsyncConfig {
  useFactory: (
    ...args: unknown[]
  ) => Promise<MembershipClientConfig> | MembershipClientConfig;
  imports?: ModuleMetadata['imports'];
  inject?: InjectToken[];
}
