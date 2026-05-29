import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type { TiktokenModel } from 'js-tiktoken';
import { TextChunkerService } from './text-chunker.service';
import {
  parseJsonResponse,
  validateSourceIndices,
} from '../ai-gateway/services/parse-json.util';
import type {
  AiDocumentUploadEvent,
  AiDocumentProcessedEvent,
  AiDocumentQueryEvent,
  AiDocumentQueryResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

interface SimilarityRow {
  similarity?: string;
}

const OPENAI_EMBEDDING_MODELS: readonly TiktokenModel[] = [
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
];

const VOYAGE_EMBEDDING_MODELS: readonly string[] = [
  'voyage-3',
  'voyage-3-lite',
  'voyage-code-2',
];

const SUPPORTED_EMBEDDING_MODELS: readonly string[] = [
  ...OPENAI_EMBEDDING_MODELS,
  ...VOYAGE_EMBEDDING_MODELS,
];

function resolveEmbeddingModel(configured: string | undefined): string {
  const fallback = 'text-embedding-3-small';
  if (!configured) return fallback;
  if (!(SUPPORTED_EMBEDDING_MODELS as readonly string[]).includes(configured)) {
    throw new Error(
      `Unsupported embedding model "${configured}". ` +
        `Supported models: ${SUPPORTED_EMBEDDING_MODELS.join(', ')}`,
    );
  }
  return configured;
}

function resolveEmbeddingProvider(model: string): string {
  if ((OPENAI_EMBEDDING_MODELS as readonly string[]).includes(model))
    return 'openai';
  if ((VOYAGE_EMBEDDING_MODELS as readonly string[]).includes(model))
    return 'voyageai';
  return 'unknown';
}

function resolveTiktokenModel(embeddingModel: string): TiktokenModel {
  if ((OPENAI_EMBEDDING_MODELS as readonly string[]).includes(embeddingModel)) {
    return embeddingModel as TiktokenModel;
  }
  return 'text-embedding-3-small';
}

@Injectable()
export class DocumentEngine {
  private readonly logger = new Logger(DocumentEngine.name);
  private readonly maxDocSizeMb: number;
  private readonly maxPages: number;
  private readonly embeddingModel: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly chunker: TextChunkerService,
    @InjectRepository(DocumentMetadata)
    private readonly docMetaRepo: Repository<DocumentMetadata>,
    @InjectRepository(DocumentChunk)
    private readonly chunkRepo: Repository<DocumentChunk>,
  ) {
    this.maxDocSizeMb = this.config.aiMaxDocumentSizeMb ?? 10;
    this.maxPages = this.config.aiMaxDocumentPages ?? 200;
    this.embeddingModel = resolveEmbeddingModel(this.config.aiEmbeddingModel);
  }

  async processDocument(
    event: AiDocumentUploadEvent,
    textContent: string,
  ): Promise<AiDocumentProcessedEvent> {
    try {
      if (event.file_size > this.maxDocSizeMb * 1024 * 1024) {
        throw new Error(`Document exceeds ${this.maxDocSizeMb}MB limit`);
      }

      // M3: file_key is the canonical chunk identifier and is NOT NULL at
      // the DB level. Kafka deserialization bypasses class-validator, so
      // validate the input up-front — BEFORE any DB write, chunking, or
      // embedding spend. A malformed/replayed event surfaces immediately
      // as a clean status='failed' result via the catch block below.
      if (typeof event.file_key !== 'string' || event.file_key.length === 0) {
        throw new Error(
          `AiDocumentUpload event missing required file_key for document ${event.document_id}; cannot ingest`,
        );
      }

      // The row is pre-created by media-service.confirmUploaded with
      // status='pending' before the AiDocumentUpload event is emitted, so
      // we only need to transition status here. Fall back to an upsert if
      // the row is somehow missing (legacy events, manual replays, etc.)
      // to keep the consumer resilient against schema-evolution gaps.
      const updateResult = await this.docMetaRepo.update(
        { id: event.document_id },
        { status: 'processing' },
      );
      if (!updateResult.affected) {
        await this.docMetaRepo.save(
          this.docMetaRepo.create({
            id: event.document_id,
            conversationId: event.conversation_id,
            userId: event.user_id,
            fileKey: event.file_key,
            fileName: event.file_name,
            fileSize: event.file_size,
            contentType: event.content_type,
            status: 'processing',
          }),
        );
      }

      const chunks = await this.chunker.chunk(textContent, {
        size: 400,
        overlap: 50,
        model: resolveTiktokenModel(this.embeddingModel),
      });

      if (chunks.length === 0) {
        throw new Error(
          'No text content could be extracted from this document. It may be a scanned image or contain no readable text.',
        );
      }

      const embeddingResults = await this.gateway.embedBatch(
        event.user_id,
        chunks,
        this.embeddingModel,
      );

      const totalTokens = embeddingResults.reduce(
        (sum, r) => sum + r.tokensUsed,
        0,
      );

      // M3: chunks are scoped by file_key alone (document_id column dropped).
      // file_key was validated up-front; safe to use directly here.
      const chunkEntities: DocumentChunk[] = embeddingResults.map((result, i) =>
        this.chunkRepo.create({
          fileKey: event.file_key,
          chunkIndex: i,
          content: chunks[i],
          tokenCount: result.tokensUsed,
          embedding: JSON.stringify(result.embedding),
          embeddingModel: this.embeddingModel,
          embeddingVersion: 1,
        }),
      );

      await this.chunkRepo.save(chunkEntities);

      await this.docMetaRepo.update(
        { id: event.document_id },
        {
          status: 'completed',
          chunkCount: chunks.length,
          totalTokens,
          embeddingModel: this.embeddingModel,
          embeddingVersion: 1,
        },
      );

      this.aiMetrics.recordRequest(
        'document_analysis',
        embeddingResults[0]?.provider ?? 'unknown',
        this.embeddingModel,
        totalTokens,
        0,
        0,
        true,
      );

      return {
        document_id: event.document_id,
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        status: 'completed',
        chunk_count: chunks.length,
        total_tokens: totalTokens,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.recordDocumentFailure(event, errorMsg);
    }
  }

  async recordDocumentFailure(
    event: AiDocumentUploadEvent,
    errorMessage: string,
  ): Promise<AiDocumentProcessedEvent> {
    this.logger.error(`Document processing failed: ${errorMessage}`);

    const updateResult = await this.docMetaRepo.update(
      { id: event.document_id },
      {
        status: 'failed',
        errorMessage,
        chunkCount: 0,
        totalTokens: 0,
      },
    );

    if (!updateResult.affected) {
      const failedMetadata = this.docMetaRepo.create({
        id: event.document_id,
        conversationId: event.conversation_id,
        userId: event.user_id,
        fileKey: event.file_key,
        fileName: event.file_name,
        fileSize: event.file_size,
        contentType: event.content_type,
        status: 'failed',
        chunkCount: 0,
        totalTokens: 0,
        errorMessage,
      });
      await this.docMetaRepo.save(failedMetadata);
    }

    this.aiMetrics.recordRequest(
      'document_analysis',
      resolveEmbeddingProvider(this.embeddingModel),
      this.embeddingModel,
      0,
      0,
      0,
      false,
    );

    return {
      document_id: event.document_id,
      conversation_id: event.conversation_id,
      user_id: event.user_id,
      status: 'failed',
      chunk_count: 0,
      total_tokens: 0,
      error_message: errorMessage,
      processed_at: Date.now(),
      trace_id: event.trace_id,
    };
  }

  private async searchRelevantChunks(event: AiDocumentQueryEvent): Promise<{
    chunks: Array<{
      content: string;
      chunkIndex: number;
      similarity: number;
    }>;
    embeddingTokens: number;
  }> {
    const topK = event.top_k ?? 5;

    // M2: resolve document_id → file_key so re-linked DocumentMetadata rows
    // for the same file all share one set of chunks (no re-embedding).
    // Filter by userId so this path matches DocumentRagService.buildRagMessages
    // — a leaked document_id from another user cannot pull chunks here.
    const doc = await this.docMetaRepo.findOne({
      where: { id: event.document_id, userId: event.user_id },
    });
    if (!doc) {
      this.logger.warn(
        `searchRelevantChunks: DocumentMetadata not found for id=${event.document_id} user=${event.user_id}, returning empty`,
      );
      return { chunks: [], embeddingTokens: 0 };
    }

    const queryEmbedding = await this.gateway.embed(
      event.user_id,
      event.query,
      this.embeddingModel,
    );

    const result = await this.chunkRepo
      .createQueryBuilder('chunk')
      .select(['chunk.id', 'chunk.chunkIndex', 'chunk.content'])
      .addSelect(
        `1 - (chunk.embedding::vector <=> :queryVector::vector)`,
        'similarity',
      )
      .where('chunk.file_key = :fileKey', { fileKey: doc.fileKey })
      .andWhere('chunk.embeddingModel = :embeddingModel', {
        embeddingModel: this.embeddingModel,
      })
      .setParameter('queryVector', JSON.stringify(queryEmbedding.embedding))
      .orderBy('similarity', 'DESC')
      .limit(topK)
      .getRawAndEntities();

    const chunks = result.raw.map((row: SimilarityRow, i: number) => ({
      content: result.entities[i]?.content ?? '',
      chunkIndex: result.entities[i]?.chunkIndex ?? 0,
      similarity: parseFloat(row.similarity ?? '0'),
    }));

    return { chunks, embeddingTokens: queryEmbedding.tokensUsed };
  }

  async queryDocument(
    event: AiDocumentQueryEvent,
  ): Promise<AiDocumentQueryResultEvent> {
    try {
      const { chunks: relevantChunks, embeddingTokens } =
        await this.searchRelevantChunks(event);

      if (relevantChunks.length === 0) {
        return {
          document_id: event.document_id,
          conversation_id: event.conversation_id,
          user_id: event.user_id,
          query: event.query,
          answer:
            'No content was found in this document to answer your question.',
          sources: [],
          provider: 'openai',
          tokens_used: embeddingTokens,
          processed_at: Date.now(),
          trace_id: event.trace_id,
        };
      }

      const messages = this.promptBuilder.buildDocumentQueryPrompt(
        event.query,
        relevantChunks.map((c) => ({
          content: c.content,
          chunkIndex: c.chunkIndex,
        })),
      );

      const result = await this.gateway.complete(event.user_id, {
        messages,
        maxTokens: 1024,
        temperature: 0.3,
      });

      const parsed = this.parseQueryResponse(
        result.content,
        relevantChunks.length,
      );

      this.aiMetrics.recordRequest(
        'document_analysis',
        result.provider,
        result.model,
        result.tokensIn + embeddingTokens,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      return {
        document_id: event.document_id,
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        query: event.query,
        answer: parsed.answer,
        sources: relevantChunks.map((c) => ({
          chunk_index: c.chunkIndex,
          content_preview: c.content.slice(0, 200),
          similarity_score: c.similarity,
        })),
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut + embeddingTokens,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    } catch (error) {
      this.logger.error(
        `Document query failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        document_id: event.document_id,
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        query: event.query,
        answer: 'Failed to query document. Please try again later.',
        sources: [],
        provider: 'openai',
        tokens_used: 0,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private parseQueryResponse(
    content: string,
    chunkCount: number,
  ): {
    answer: string;
    source_indices: number[];
  } {
    try {
      const json = parseJsonResponse(content) as Record<string, unknown>;
      return {
        answer: typeof json.answer === 'string' ? json.answer : content,
        source_indices: validateSourceIndices(json.source_indices, chunkCount),
      };
    } catch {
      return { answer: content, source_indices: [] };
    }
  }
}
