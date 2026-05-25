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
    buildDocumentQueryPrompt: jest
      .fn()
      .mockReturnValue([{ role: 'system', content: 'doc prompt' }]),
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
    it('happy path: embeds query, runs vector search, calls promptBuilder with chunks', async () => {
      const messages = await service.buildRagMessages(
        USER_ID,
        DOC_ID,
        'What is the main point?',
      );

      expect(gateway.embed).toHaveBeenCalledWith(
        USER_ID,
        'What is the main point?',
        'text-embedding-3-small',
      );
      expect(chunkRepo.createQueryBuilder).toHaveBeenCalled();
      expect(promptBuilder.buildDocumentQueryPrompt).toHaveBeenCalledWith(
        'What is the main point?',
        [
          { content: 'chunk content 0', chunkIndex: 0 },
          { content: 'chunk content 1', chunkIndex: 1 },
        ],
      );
      expect(messages).toEqual([{ role: 'system', content: 'doc prompt' }]);
    });

    it('empty vector search → calls promptBuilder with empty chunks (no throw)', async () => {
      chunkRepo._qb.getRawAndEntities.mockResolvedValueOnce({
        raw: [],
        entities: [],
      });

      const messages = await service.buildRagMessages(
        USER_ID,
        DOC_ID,
        'no matches',
      );

      expect(promptBuilder.buildDocumentQueryPrompt).toHaveBeenCalledWith(
        'no matches',
        [],
      );
      expect(messages).toEqual([{ role: 'system', content: 'doc prompt' }]);
    });

    it('propagates errors from gateway.embed (not swallowed)', async () => {
      (gateway.embed as jest.Mock).mockRejectedValue(
        new Error('embedding failed'),
      );

      await expect(
        service.buildRagMessages(USER_ID, DOC_ID, 'q'),
      ).rejects.toThrow('embedding failed');
    });

    it('applies similarity threshold filter and limit in query builder', async () => {
      await service.buildRagMessages(USER_ID, DOC_ID, 'q');

      expect(chunkRepo._qb.setParameter).toHaveBeenCalledWith('threshold', 0.7);
      expect(chunkRepo._qb.limit).toHaveBeenCalledWith(5);
      expect(chunkRepo._qb.orderBy).toHaveBeenCalledWith('similarity', 'DESC');
    });
  });
});
