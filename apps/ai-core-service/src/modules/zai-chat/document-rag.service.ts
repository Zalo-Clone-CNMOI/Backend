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
// Cosine-similarity floor for a chunk to be considered relevant. Tuned for
// voyage-3 (the default embedder), whose relevant-pair scores sit ~0.4-0.65 —
// markedly lower than OpenAI text-embedding-3-small (~0.75-0.85). The old 0.7
// floor was an OpenAI value that silently rejected EVERY voyage-3 match, so
// doc-chat always saw zero context. The sibling RAG path
// (document.engine.searchRelevantChunks) uses no floor at all; this keeps a
// low one purely to drop obvious noise on vague queries.
const SIMILARITY_THRESHOLD = 0.3;

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

    const queryEmbedding = await this.gateway.embed(
      userId,
      query,
      queryEmbeddingModel,
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
      .filter((c) => c.similarity >= SIMILARITY_THRESHOLD)
      .map((c) => ({ content: c.content, chunkIndex: c.chunkIndex }));

    // Diagnostic: candidate count distinguishes "no chunks stored for this
    // file_key" (0 candidates) from "stored but all below the floor"
    // (candidates > 0, low top score). topSimilarity shows the real ceiling.
    this.logger.debug(
      `RAG query for doc ${documentId} (file_key=${doc.fileKey}, model=${queryEmbeddingModel}): ` +
        `${scored.length} candidate chunk(s), ` +
        `topSimilarity=${scored[0]?.similarity.toFixed(3) ?? 'n/a'}, ` +
        `${chunks.length} >= threshold ${SIMILARITY_THRESHOLD}`,
    );

    return this.promptBuilder.buildDocumentChatPrompt(history, query, chunks);
  }
}
