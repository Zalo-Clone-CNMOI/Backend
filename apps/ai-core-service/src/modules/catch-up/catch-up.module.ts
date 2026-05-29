import { Module } from '@nestjs/common';
import { ScyllaModule } from '@libs/scylla';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { CatchUpEngine } from './catch-up.engine';
import { CatchUpController } from './catch-up.controller';

// AiGatewayModule is @Global — AiGatewayService, PromptBuilderService, and
// AiMetricsService are available without explicit import here.
// RedisModule is registered globally in AppModule — RedisService is available.
// ConversationMembershipModule provides ConversationMembershipService for the
// defense-in-depth membership check (reads the shared ConversationMember table).
@Module({
  imports: [ScyllaModule, ConversationMembershipModule],
  providers: [CatchUpEngine],
  controllers: [CatchUpController],
  exports: [CatchUpEngine],
})
export class CatchUpModule {}
