import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScyllaModule } from '@libs/scylla';
import { DocumentChunk, DocumentMetadata } from '@libs/database/entities';
import { ZaiChatEngine } from './zai-chat.engine';
import { DocumentRagService } from './document-rag.service';
import { ZaiMemoryService } from './zai-memory.service';

// AiGatewayModule is @Global — AiGatewayService, PromptBuilderService, and
// AiMetricsService are available without explicit import here.
// RedisModule is @Global — RedisService is available without explicit import.
// ConfigModule is @Global — APP_CONFIG is available without explicit import.
@Module({
  imports: [
    ScyllaModule,
    TypeOrmModule.forFeature([DocumentChunk, DocumentMetadata]),
  ],
  providers: [ZaiChatEngine, DocumentRagService, ZaiMemoryService],
  exports: [ZaiChatEngine],
})
export class ZaiChatModule {}
