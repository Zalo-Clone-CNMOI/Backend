import { Module } from '@nestjs/common';
import { ScyllaModule } from '@libs/scylla';
import { ZaiChatEngine } from './zai-chat.engine';

// AiGatewayModule is @Global — AiGatewayService, PromptBuilderService, and
// AiMetricsService are available without explicit import here.
// ConfigModule is @Global — APP_CONFIG is available without explicit import.
@Module({
  imports: [ScyllaModule],
  providers: [ZaiChatEngine],
  exports: [ZaiChatEngine],
})
export class ZaiChatModule {}
