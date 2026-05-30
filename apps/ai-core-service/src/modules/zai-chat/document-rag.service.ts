import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import { BusinessException } from '@app/types';
import { ErrorCode } from '@app/constant';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import type { LlmChatMessage } from '../ai-gateway/interfaces';

const TOP_K = 5;
// NO similarity floor for document-anchored chat. The conversation is bound to
// ONE specific document, so the user's intent is "answer from THIS file" — the
// top-K nearest chunks are always the best available context and withholding
// them (the old behavior) is what made Zai answer with zero document context.
// The sibling path (document.engine.searchRelevantChunks) likewise uses no
// floor. Threshold tuning here was a red herring: the real cause of the
// ~0.08 scores was an embedding provider/input_type mismatch (now fixed in
// AiGatewayService.resolveEmbeddingProvider + VoyageAiProvider input_type), not
// a too-high cutoff. We keep only a defensive drop of non-positive similarities.
const MIN_POSITIVE_SIMILARITY = 0;

interface SimilarityRow {
  similarity?: string;
}

@Injectable()
export class DocumentRagService {
  private readonly logger = new Logger(DocumentRagService.name);

  constructor(
    @InjectRepository(DocumentChunk)
    private readonly chunkRepo: Repository<DocumentChunk>,
    @InjectRepository(DocumentMetadata)
    private readonly docMetaRepo: Repository<DocumentMetadata>,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async validateDocumentAccess(
    userId: string,
    documentId: string,
  ): Promise<DocumentMetadata> {
    const doc = await this.docMetaRepo.findOne({
      where: { id: documentId, userId },
    });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Document not found or access denied',
      );
    }
    return doc;
  }

  async buildRagMessages(
    userId: string,
    documentId: string,
    query: string,
    history: LlmChatMessage[],
  ): Promise<LlmChatMessage[]> {
    const doc = await this.docMetaRepo.findOne({
      where: { id: documentId, userId },
    });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Document not found or access denied',
      );
    }

    if (doc.status === 'failed') {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Document ingest previously failed. Please re-upload to retry.',
      );
    }
    if (doc.status === 'pending' || doc.status === 'processing') {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Document is still being processed. Please try again in a moment.',
      );
    }

    const queryEmbeddingModel = this.config.aiEmbeddingModel ?? 'voyage-3';

    // inputType:'query' — the asymmetric counterpart to the 'document' vectors
    // stored at ingest. This is the single most important line for relevance:
    // without it Voyage returns a vector in a different space and cosine
    // similarity to the stored chunks collapses toward zero.
    const queryEmbedding = await this.gateway.embed(
      userId,
      query,
      queryEmbeddingModel,
      'query',
    );

    // Fetch top-K by similarity WITHOUT the threshold in SQL, so we can log the
    // real scores and apply the floor in-app. Filter by embedding_model to
    // compare only against same-dimension vectors — a file_key may carry rows
    // from an earlier embedder (text-embedding-3-small=1536) alongside the
    // current voyage-3=1024, and pgvector's <=> throws on mixed dimensions.
    const result = await this.chunkRepo
      .createQueryBuilder('chunk')
      .select(['chunk.id', 'chunk.chunkIndex', 'chunk.content'])
      .addSelect(
        `1 - (chunk.embedding::vector <=> :queryVector::vector)`,
        'similarity',
      )
      .where('chunk.file_key = :fileKey', { fileKey: doc.fileKey })
      .andWhere('chunk.embeddingModel = :embeddingModel', {
        embeddingModel: queryEmbeddingModel,
      })
      .setParameter('queryVector', JSON.stringify(queryEmbedding.embedding))
      .orderBy('similarity', 'DESC')
      .limit(TOP_K)
      .getRawAndEntities();

    const scored = result.raw.map((row: SimilarityRow, i: number) => ({
      content: result.entities[i]?.content ?? '',
      chunkIndex: result.entities[i]?.chunkIndex ?? 0,
      similarity: parseFloat(row.similarity ?? '0'),
    }));

    const chunks = scored
      .filter((c) => c.similarity > MIN_POSITIVE_SIMILARITY)
      .map((c) => ({ content: c.content, chunkIndex: c.chunkIndex }));

    // Diagnostic (Bug #1): logs everything needed to confirm the fix from ONE
    // production line — which provider actually ran, the query vector dimension,
    // candidate count, and the real top similarity. A healthy voyage-3
    // document/query pair scores ~0.4-0.7; a dimension/provider mismatch shows
    // up as a tiny topSimilarity AND/OR a queryDim that differs from the stored
    // chunk dimension.
    this.logger.debug(
      `RAG query for doc ${documentId} (file_key=${doc.fileKey}, ` +
        `model=${queryEmbeddingModel}, provider=${queryEmbedding.provider}, ` +
        `actualModel=${queryEmbedding.model}, queryDim=${queryEmbedding.embedding.length}): ` +
        `${scored.length} candidate chunk(s), ` +
        `topSimilarity=${scored[0]?.similarity.toFixed(3) ?? 'n/a'}, ` +
        `${chunks.length} selected (no floor)`,
    );

    return this.promptBuilder.buildDocumentChatPrompt(history, query, chunks);
  }
}
