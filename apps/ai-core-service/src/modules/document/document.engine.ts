/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { OpenAiProvider } from '../ai-gateway/providers/openai.provider';
import type {
  AiDocumentUploadEvent,
  AiDocumentProcessedEvent,
  AiDocumentQueryEvent,
  AiDocumentQueryResultEvent,
  AiProviderType,
} from '@libs/contracts';

interface SimilarityRow {
  similarity?: string;
}

const toAiProviderType = (provider: string): AiProviderType => {
  if (
    provider === 'openai' ||
    provider === 'gemini' ||
    provider === 'anthropic'
  ) {
    return provider;
  }
  return 'openai';
};

/**
 * DocumentEngine — document processing + pgvector RAG pipeline.
 *
 * Processing flow:
 *   1. Parse document (PDF/DOCX/CSV/TXT)
 *   2. Chunk text with overlap
 *   3. Generate embeddings via OpenAI text-embedding-3-small
 *   4. Store chunks + embeddings in PostgreSQL with pgvector
 *
 * Query flow:
 *   1. Embed query text
 *   2. Similarity search using pgvector cosine distance
 *   3. Build RAG prompt with top-k chunks
 *   4. Generate answer via LLM
 */
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
    private readonly openaiProvider: OpenAiProvider,
    @InjectRepository(DocumentMetadata)
    private readonly docMetaRepo: Repository<DocumentMetadata>,
    @InjectRepository(DocumentChunk)
    private readonly chunkRepo: Repository<DocumentChunk>,
  ) {
    this.maxDocSizeMb = this.config.aiMaxDocumentSizeMb ?? 10;
    this.maxPages = this.config.aiMaxDocumentPages ?? 200;
    this.embeddingModel =
      this.config.aiEmbeddingModel ?? 'text-embedding-3-small';
  }

  /**
   * Process an uploaded document: parse, chunk, embed, store.
   */
  async processDocument(
    event: AiDocumentUploadEvent,
    textContent: string,
  ): Promise<AiDocumentProcessedEvent> {
    try {
      // Validate size
      if (event.file_size > this.maxDocSizeMb * 1024 * 1024) {
        throw new Error(`Document exceeds ${this.maxDocSizeMb}MB limit`);
      }

      // Upsert metadata row and set status to processing
      const processingMetadata = this.docMetaRepo.create({
        id: event.document_id,
        conversationId: event.conversation_id,
        userId: event.user_id,
        fileKey: event.file_key,
        fileName: event.file_name,
        fileSize: event.file_size,
        contentType: event.content_type,
        status: 'processing',
      });
      await this.docMetaRepo.save(processingMetadata);

      // Chunk the text
      const chunks = this.chunkText(textContent, 500, 50);

      // Generate embeddings and store chunks
      let totalTokens = 0;
      const chunkEntities: DocumentChunk[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const embeddingResult = await this.openaiProvider.embed(
          chunks[i],
          this.embeddingModel,
        );

        totalTokens += embeddingResult.tokensUsed;

        const chunkEntity = this.chunkRepo.create({
          documentId: event.document_id,
          chunkIndex: i,
          content: chunks[i],
          tokenCount: embeddingResult.tokensUsed,
          embedding: JSON.stringify(embeddingResult.embedding),
          embeddingModel: this.embeddingModel,
          embeddingVersion: 1,
        });

        chunkEntities.push(chunkEntity);
      }

      // Batch save chunks
      await this.chunkRepo.save(chunkEntities);

      // Update document metadata
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
        'openai',
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
      this.logger.error(`Document processing failed: ${errorMsg}`);

      await this.docMetaRepo.update(
        { id: event.document_id },
        { status: 'failed', errorMessage: errorMsg },
      );

      this.aiMetrics.recordRequest(
        'document_analysis',
        'openai',
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
        error_message: errorMsg,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  /**
   * Query a document using vector similarity search + RAG.
   */
  async queryDocument(
    event: AiDocumentQueryEvent,
  ): Promise<AiDocumentQueryResultEvent> {
    try {
      const topK = event.top_k ?? 5;

      // Embed the query
      const queryEmbedding = await this.openaiProvider.embed(
        event.query,
        this.embeddingModel,
      );

      // Vector similarity search using pgvector
      // NOTE: Requires pgvector extension and proper column type via migration
      const chunks = await this.chunkRepo
        .createQueryBuilder('chunk')
        .select(['chunk.id', 'chunk.chunkIndex', 'chunk.content'])
        .addSelect(
          `1 - (chunk.embedding::vector <=> :queryVector::vector)`,
          'similarity',
        )
        .where('chunk.document_id = :documentId', {
          documentId: event.document_id,
        })
        .setParameter('queryVector', JSON.stringify(queryEmbedding.embedding))
        .orderBy('similarity', 'DESC')
        .limit(topK)
        .getRawAndEntities();

      const relevantChunks = chunks.raw.map(
        (row: SimilarityRow, i: number) => ({
          content: chunks.entities[i]?.content ?? '',
          chunkIndex: chunks.entities[i]?.chunkIndex ?? 0,
          similarity: parseFloat(row.similarity ?? '0'),
        }),
      );

      // Build RAG prompt and generate answer
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

      const parsed = this.parseQueryResponse(result.content);

      this.aiMetrics.recordRequest(
        'document_analysis',
        result.provider,
        result.model,
        result.tokensIn + queryEmbedding.tokensUsed,
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
        tokens_used:
          result.tokensIn + result.tokensOut + queryEmbedding.tokensUsed,
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

  /**
   * Chunk text into overlapping segments.
   */
  private chunkText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim()) {
        chunks.push(chunk.trim());
      }
    }

    return chunks;
  }

  private parseQueryResponse(content: string): {
    answer: string;
    source_indices: number[];
  } {
    try {
      const json = JSON.parse(content);
      return {
        answer: json.answer ?? content,
        source_indices: Array.isArray(json.source_indices)
          ? json.source_indices
          : [],
      };
    } catch {
      return { answer: content, source_indices: [] };
    }
  }
}
