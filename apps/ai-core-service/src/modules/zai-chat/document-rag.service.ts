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
const SIMILARITY_THRESHOLD = 0.7;

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
  ): Promise<LlmChatMessage[]> {
    const queryEmbedding = await this.gateway.embed(
      userId,
      query,
      this.config.aiEmbeddingModel,
    );

    const result = await this.chunkRepo
      .createQueryBuilder('chunk')
      .select(['chunk.id', 'chunk.chunkIndex', 'chunk.content'])
      .addSelect(
        `1 - (chunk.embedding::vector <=> :queryVector::vector)`,
        'similarity',
      )
      .where('chunk.document_id = :documentId', { documentId })
      .andWhere(
        `1 - (chunk.embedding::vector <=> :queryVector::vector) >= :threshold`,
      )
      .setParameter('queryVector', JSON.stringify(queryEmbedding.embedding))
      .setParameter('threshold', SIMILARITY_THRESHOLD)
      .orderBy('similarity', 'DESC')
      .limit(TOP_K)
      .getRawAndEntities();

    const chunks = result.raw.map((row: SimilarityRow, i: number) => ({
      content: result.entities[i]?.content ?? '',
      chunkIndex: result.entities[i]?.chunkIndex ?? 0,
    }));

    this.logger.debug(
      `RAG query for doc ${documentId}: ${chunks.length} chunks above threshold`,
    );

    return this.promptBuilder.buildDocumentQueryPrompt(query, chunks);
  }
}
