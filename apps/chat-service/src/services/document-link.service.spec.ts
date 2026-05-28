import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentMetadata } from '@libs/database';
import { DocumentLinkService } from './document-link.service';

const SENDER = 'user-sender';
const CONV = 'conv-123';
const FILE_KEY = 'uploads/shared.pdf';

function makeAttachment() {
  return {
    file_key: FILE_KEY,
    file_name: 'shared.pdf',
    file_size: 1024,
    content_type: 'application/pdf',
  };
}

function makeMetadataRow(overrides: Partial<DocumentMetadata> = {}) {
  return {
    id: 'doc-existing',
    conversationId: CONV,
    userId: SENDER,
    fileKey: FILE_KEY,
    fileName: 'shared.pdf',
    fileSize: 1024,
    contentType: 'application/pdf',
    status: 'ready',
    chunkCount: 5,
    totalTokens: 1500,
    embeddingModel: 'text-embedding-3-small',
    embeddingVersion: 1,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as DocumentMetadata;
}

describe('DocumentLinkService', () => {
  let service: DocumentLinkService;
  let docMetaRepo: jest.Mocked<Repository<DocumentMetadata>>;

  beforeEach(async () => {
    docMetaRepo = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: Partial<DocumentMetadata>) => ({
          ...data,
        })),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<DocumentMetadata>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentLinkService,
        {
          provide: getRepositoryToken(DocumentMetadata),
          useValue: docMetaRepo,
        },
      ],
    }).compile();

    service = module.get(DocumentLinkService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('fast path — sender already has metadata in this conversation', () => {
    it('returns ready with the existing document_id when status=ready', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(makeMetadataRow());

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({
        kind: 'ready',
        documentId: 'doc-existing',
        fileKey: FILE_KEY,
      });
      expect(docMetaRepo.save).not.toHaveBeenCalled();
    });

    it('accepts status=completed as ready (DocumentEngine writes "completed")', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(
        makeMetadataRow({ status: 'completed' }),
      );

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result.kind).toBe('ready');
    });

    it('returns pending when own metadata exists but is still processing', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(
        makeMetadataRow({ status: 'pending' }),
      );

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({ kind: 'pending', documentId: 'doc-existing' });
    });

    it('returns failed when own metadata records a prior ingest failure', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(
        makeMetadataRow({ status: 'failed' }),
      );

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({ kind: 'failed', documentId: 'doc-existing' });
    });
  });

  describe('re-link path — different user/conv but same file_key has ready chunks', () => {
    it('inserts a new row with whitelisted fields from a ready reference and returns ready', async () => {
      // 1st findOne (own): miss. 2nd findOne (reference): hit ready row.
      docMetaRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
        makeMetadataRow({
          id: 'doc-reference',
          userId: 'other-user',
          conversationId: 'other-conv',
          status: 'completed',
        }),
      );
      docMetaRepo.save.mockResolvedValueOnce(
        makeMetadataRow({
          id: 'doc-new',
          userId: SENDER,
          conversationId: CONV,
          status: 'ready',
        }),
      );

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(docMetaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: SENDER,
          conversationId: CONV,
          fileKey: FILE_KEY,
          status: 'ready',
        }),
      );
      // Whitelist enforcement: must NOT carry the source's user/conversation.
      const createArg = docMetaRepo.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArg.userId).not.toBe('other-user');
      expect(createArg.conversationId).not.toBe('other-conv');
      // Reusable content fields ARE copied:
      expect(createArg.fileName).toBe('shared.pdf');
      expect(createArg.embeddingModel).toBe('text-embedding-3-small');

      expect(result).toEqual({
        kind: 'ready',
        documentId: 'doc-new',
        fileKey: FILE_KEY,
      });
    });

    it('returns missing when no ready reference exists for this file_key', async () => {
      docMetaRepo.findOne
        .mockResolvedValueOnce(null) // own miss
        .mockResolvedValueOnce(null); // reference miss

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({ kind: 'missing' });
      expect(docMetaRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('race handling — concurrent insert (unique violation)', () => {
    it('reuses the concurrent winner on SQLSTATE 23505 from the driver root', async () => {
      docMetaRepo.findOne
        .mockResolvedValueOnce(null) // own
        .mockResolvedValueOnce(
          makeMetadataRow({ id: 'doc-ref', status: 'ready' }),
        ) // reference
        .mockResolvedValueOnce(
          makeMetadataRow({ id: 'doc-winner', status: 'ready' }),
        ); // re-query after 23505

      const uniqueErr = new Error('duplicate key') as Error & {
        code: string;
      };
      uniqueErr.code = '23505';
      docMetaRepo.save.mockRejectedValueOnce(uniqueErr);

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({
        kind: 'ready',
        documentId: 'doc-winner',
        fileKey: FILE_KEY,
      });
    });

    it('reuses the concurrent winner on SQLSTATE 23505 nested under driverError', async () => {
      docMetaRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeMetadataRow({ id: 'doc-ref' }))
        .mockResolvedValueOnce(
          makeMetadataRow({ id: 'doc-winner-2', status: 'ready' }),
        );

      const uniqueErr = new Error('duplicate key') as Error & {
        driverError: { code: string };
      };
      uniqueErr.driverError = { code: '23505' };
      docMetaRepo.save.mockRejectedValueOnce(uniqueErr);

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result.kind).toBe('ready');
      expect((result as { documentId: string }).documentId).toBe(
        'doc-winner-2',
      );
    });

    it('rethrows non-unique-violation save errors (no silent swallow)', async () => {
      docMetaRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeMetadataRow());
      docMetaRepo.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.resolveForUser(SENDER, CONV, makeAttachment()),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('whitelist enforcement', () => {
    it('does NOT copy source createdAt / id / conversationId / userId when re-linking', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
        makeMetadataRow({
          id: 'doc-source',
          userId: 'evil-user',
          conversationId: 'evil-conv',
          status: 'ready',
          createdAt: new Date('2024-01-01'),
        }),
      );
      docMetaRepo.save.mockResolvedValueOnce(
        makeMetadataRow({ id: 'doc-new', status: 'ready' }),
      );

      await service.resolveForUser(SENDER, CONV, makeAttachment());

      const createArg = docMetaRepo.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArg).not.toHaveProperty('id');
      expect(createArg).not.toHaveProperty('createdAt');
      expect(createArg.userId).toBe(SENDER);
      expect(createArg.conversationId).toBe(CONV);
    });
  });

  describe('unrecognized status fallback', () => {
    it('treats an unknown status as missing rather than routing into a broken state', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(
        makeMetadataRow({ status: 'archived-future-status' }),
      );

      const result = await service.resolveForUser(
        SENDER,
        CONV,
        makeAttachment(),
      );

      expect(result).toEqual({ kind: 'missing' });
    });
  });
});
