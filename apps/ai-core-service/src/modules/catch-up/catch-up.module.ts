import { Module } from '@nestjs/common';
import { ScyllaModule } from '@libs/scylla';
import { CatchUpEngine } from './catch-up.engine';
import { CatchUpController } from './catch-up.controller';

// AiGatewayModule is @Global — AiGatewayService, PromptBuilderService, and
// AiMetricsService are available without explicit import here.
// RedisModule is registered globally in AppModule — RedisService is available.
@Module({
  imports: [ScyllaModule],
  providers: [CatchUpEngine],
  controllers: [CatchUpController],
  exports: [CatchUpEngine],
})
export class CatchUpModule {}
