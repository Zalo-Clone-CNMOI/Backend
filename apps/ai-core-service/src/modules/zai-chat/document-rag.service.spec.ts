import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentRagService } from './document-rag.service';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { DocumentChunk, DocumentMetadata } from '@libs/database/entities';
import { APP_CONFIG } from '@libs/config';
import { BusinessException } from '@app/types';

const USER_ID = 'user-001';
const DOC_ID = 'doc-001';

function makeQueryBuilder() {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({
      raw: [{ similarity: '0.92' }, { similarity: '0.85' }],
      entities: [
        { chunkIndex: 0, content: 'chunk content 0' },
        { chunkIndex: 1, content: 'chunk content 1' },
      ],
    }),
  };
  return qb;
}

function makeChunkRepo() {
  const qb = makeQueryBuilder();
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  } as unknown as jest.Mocked<Repository<DocumentChunk>> & {
    _qb: ReturnType<typeof makeQueryBuilder>;
  };
}

function makeDocMetaRepo() {
  return {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<DocumentMetadata>>;
}

function makeGateway(): jest.Mocked<AiGatewayService> {
  return {
    embed: jest.fn().mockResolvedValue({
      embedding: new Array(1536).fill(0.1),
      tokensUsed: 5,
      model: 'text-embedding-3-small',
      provider: 'openai',
    }),
  } as unknown as jest.Mocked<AiGatewayService>;
}

function makePromptBuilder(): jest.Mocked<PromptBuilderService> {
  return {
    buildDocumentChatPrompt: jest
      .fn()
      .mockReturnValue([{ role: 'system', content: 'doc chat prompt' }]),
  } as unknown as jest.Mocked<PromptBuilderService>;
}

describe('DocumentRagService', () => {
  let service: DocumentRagService;
  let chunkRepo: ReturnType<typeof makeChunkRepo>;
  let docMetaRepo: jest.Mocked<Repository<DocumentMetadata>>;
  let gateway: jest.Mocked<AiGatewayService>;
  let promptBuilder: jest.Mocked<PromptBuilderService>;

  beforeEach(async () => {
    chunkRepo = makeChunkRepo();
    docMetaRepo = makeDocMetaRepo();
    // M2: buildRagMessages now resolves document_id → file_key before the
    // chunk lookup. Default to a "ready" doc so the existing tests still
    // exercise the chunk search.
    (docMetaRepo.findOne as jest.Mock).mockResolvedValue({
      id: DOC_ID,
      userId: USER_ID,
      fileKey: 'uploads/doc-001.pdf',
      status: 'ready',
    });
    gateway = makeGateway();
    promptBuilder = makePromptBuilder();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentRagService,
        { provide: getRepositoryToken(DocumentChunk), useValue: chunkRepo },
        {
          provide: getRepositoryToken(DocumentMetadata),
          useValue: docMetaRepo,
        },
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useValue: promptBuilder },
        {
          provide: APP_CONFIG,
          useValue: { aiEmbeddingModel: 'text-embedding-3-small' },
        },
      ],
    }).compile();

    service = module.get<DocumentRagService>(DocumentRagService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('validateDocumentAccess', () => {
    it('returns document when ownership matches', async () => {
      const doc = { id: DOC_ID, userId: USER_ID } as DocumentMetadata;
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue(doc);

      const result = await service.validateDocumentAccess(USER_ID, DOC_ID);

      expect(docMetaRepo.findOne).toHaveBeenCalledWith({
        where: { id: DOC_ID, userId: USER_ID },
      });
      expect(result).toBe(doc);
    });

    it('throws BusinessException(NOT_FOUND) when document missing', async () => {
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.validateDocumentAccess(USER_ID, DOC_ID),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws BusinessException(NOT_FOUND) when document owned by another user', async () => {
      // findOne with { id, userId } filter returns null when userId mismatches
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.validateDocumentAccess(USER_ID, DOC_ID),
      ).rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('buildRagMessages', () => {
    it('happy path: embeds query, runs vector search, calls buildDocumentChatPrompt with history + chunks', async () => {
      const history: { role: 'user' | 'assistant'; content: string }[] = [
        { role: 'user', content: 'prior question' },
        { role: 'assistant', content: 'prior answer' },
      ];

      const messages = await service.buildRagMessages(
        USER_ID,
        DOC_ID,
        'What is the main point?',
        history,
      );

      expect(gateway.embed).toHaveBeenCalledWith(
        USER_ID,
        'What is the main point?',
        'text-embedding-3-small',
      );
      expect(chunkRepo.createQueryBuilder).toHaveBeenCalled();
      expect(promptBuilder.buildDocumentChatPrompt).toHaveBeenCalledWith(
        history,
        'What is the main point?',
        [
          { content: 'chunk content 0', chunkIndex: 0 },
          { content: 'chunk content 1', chunkIndex: 1 },
        ],
      );
      expect(messages).toEqual([
        { role: 'system', content: 'doc chat prompt' },
      ]);
    });

    it('empty vector search → calls buildDocumentChatPrompt with empty chunks (no throw)', async () => {
      chunkRepo._qb.getRawAndEntities.mockResolvedValueOnce({
        raw: [],
        entities: [],
      });

      const messages = await service.buildRagMessages(
        USER_ID,
        DOC_ID,
        'no matches',
        [],
      );

      expect(promptBuilder.buildDocumentChatPrompt).toHaveBeenCalledWith(
        [],
        'no matches',
        [],
      );
      expect(messages).toEqual([
        { role: 'system', content: 'doc chat prompt' },
      ]);
    });

    it('propagates errors from gateway.embed (not swallowed)', async () => {
      (gateway.embed as jest.Mock).mockRejectedValue(
        new Error('embedding failed'),
      );

      await expect(
        service.buildRagMessages(USER_ID, DOC_ID, 'q', []),
      ).rejects.toThrow('embedding failed');
    });

    it('orders by similarity, limits to TOP_K, and filters by embedding_model (same-dimension vectors only)', async () => {
      await service.buildRagMessages(USER_ID, DOC_ID, 'q', []);

      expect(chunkRepo._qb.limit).toHaveBeenCalledWith(5);
      expect(chunkRepo._qb.orderBy).toHaveBeenCalledWith('similarity', 'DESC');
      // The 0.7 SQL threshold is gone — filtering now happens in-app so we can
      // log real scores. The model filter guards against mixed-dimension rows.
      expect(chunkRepo._qb.setParameter).not.toHaveBeenCalledWith(
        'threshold',
        expect.anything(),
      );
      expect(chunkRepo._qb.andWhere).toHaveBeenCalledWith(
        'chunk.embeddingModel = :embeddingModel',
        { embeddingModel: 'text-embedding-3-small' },
      );
    });

    it('drops chunks scoring below the similarity floor (0.3) in-app', async () => {
      chunkRepo._qb.getRawAndEntities.mockResolvedValueOnce({
        raw: [{ similarity: '0.55' }, { similarity: '0.12' }],
        entities: [
          { chunkIndex: 0, content: 'relevant chunk' },
          { chunkIndex: 1, content: 'noise chunk' },
        ],
      });

      await service.buildRagMessages(USER_ID, DOC_ID, 'q', []);

      // Only the 0.55 chunk clears the 0.3 floor; the 0.12 chunk is dropped.
      expect(promptBuilder.buildDocumentChatPrompt).toHaveBeenCalledWith(
        [],
        'q',
        [{ content: 'relevant chunk', chunkIndex: 0 }],
      );
    });

    it('M2 — queries chunks by file_key (resolved from document_id) not document_id', async () => {
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'doc-shared',
        userId: USER_ID,
        fileKey: 'uploads/shared-physical.pdf',
        status: 'ready',
      });

      await service.buildRagMessages(USER_ID, 'doc-shared', 'q', []);

      expect(docMetaRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'doc-shared', userId: USER_ID },
      });
      expect(chunkRepo._qb.where).toHaveBeenCalledWith(
        'chunk.file_key = :fileKey',
        { fileKey: 'uploads/shared-physical.pdf' },
      );
    });

    it('M2 — throws NOT_FOUND when DocumentMetadata is missing for the user', async () => {
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.buildRagMessages(USER_ID, 'doc-other', 'q', []),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(gateway.embed).not.toHaveBeenCalled(); // no wasted embedding spend
    });

    it("M2 — surfaces a useful error when document status='failed' (don't silently return empty RAG)", async () => {
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue({
        id: DOC_ID,
        userId: USER_ID,
        fileKey: 'uploads/bad.pdf',
        status: 'failed',
      });

      let caught: unknown;
      try {
        await service.buildRagMessages(USER_ID, DOC_ID, 'q', []);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BusinessException);
      const response = (caught as BusinessException).getResponse() as {
        error: { message: string };
      };
      expect(response.error.message).toContain('previously failed');
      expect(gateway.embed).not.toHaveBeenCalled();
    });

    it("M2 — surfaces a useful error when document status='pending'", async () => {
      (docMetaRepo.findOne as jest.Mock).mockResolvedValue({
        id: DOC_ID,
        userId: USER_ID,
        fileKey: 'uploads/wip.pdf',
        status: 'pending',
      });

      let caught: unknown;
      try {
        await service.buildRagMessages(USER_ID, DOC_ID, 'q', []);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BusinessException);
      const response = (caught as BusinessException).getResponse() as {
        error: { message: string };
      };
      expect(response.error.message).toContain('still being processed');
    });
  });
});
