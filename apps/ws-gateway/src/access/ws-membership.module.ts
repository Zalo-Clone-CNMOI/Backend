import { Module } from '@nestjs/common';
import { WsMembershipService } from './ws-membership.service';

/**
 * Provides WsMembershipService to ws-gateway handlers/consumers. Its deps —
 * MembershipClientService (global MembershipClientModule, registered in
 * AppModule) and CacheService (global RedisModule) — are both already global,
 * so this module only needs to declare the provider. No TypeORM: ws-gateway
 * stays stateless.
 */
@Module({
  providers: [WsMembershipService],
  exports: [WsMembershipService],
})
export class WsMembershipModule {}
