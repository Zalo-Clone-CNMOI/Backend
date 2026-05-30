import { DocumentEngine } from './document.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { TextChunkerService } from './text-chunker.service';
import { Repository } from 'typeorm';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import type {
  AiDocumentUploadEvent,
  AiDocumentQueryEvent,
} from '@libs/contracts';
import type { LlmEmbeddingResult } from '../ai-gateway/interfaces';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUploadEvent(
  overrides: Partial<AiDocumentUploadEvent> = {},
): AiDocumentUploadEvent {
  return {
    document_id: 'doc-001',
    conversation_id: 'conv-001',
    user_id: 'user-001',
    file_key: 'uploads/doc-001.pdf',
    file_name: 'test.pdf',
    file_size: 1024,
    content_type: 'application/pdf',
    uploaded_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeEmbeddingResult(
  embedding: number[] = [0.1, 0.2],
  tokensUsed = 10,
): LlmEmbeddingResult {
  return {
    embedding,
    tokensUsed,
    model: 'text-embedding-3-small',
    provider: 'openai',
  };
}

function buildEngine(
  overrides: {
    gateway?: Partial<AiGatewayService>;
    promptBuilder?: Partial<PromptBuilderService>;
    aiMetrics?: Partial<AiMetricsService>;
    chunker?: Partial<TextChunkerService>;
    docMetaRepo?: Partial<Repository<DocumentMetadata>>;
    chunkRepo?: Partial<Repository<DocumentChunk>>;
    config?: Record<string, unknown>;
  } = {},
) {
  const config = {
    aiMaxDocumentSizeMb: 10,
    aiMaxDocumentPages: 200,
    aiEmbeddingModel: 'text-embedding-3-small',
    ...overrides.config,
  };

  const gateway = {
    complete: jest.fn(),
    embed: jest.fn(),
    embedBatch: jest.fn(),
    ...overrides.gateway,
  } as unknown as AiGatewayService;

  const promptBuilder = {
    buildDocumentQueryPrompt: jest.fn().mockReturnValue([]),
    ...overrides.promptBuilder,
  } as unknown as PromptBuilderService;

  const aiMetrics = {
    recordRequest: jest.fn(),
    ...overrides.aiMetrics,
  } as unknown as AiMetricsService;

  const chunker = {
    chunk: jest.fn().mockResolvedValue(['chunk0', 'chunk1']),
    ...overrides.chunker,
  } as unknown as TextChunkerService;

  const docMetaRepo = {
    create: jest.fn().mockImplementation((data: unknown) => data),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    // M2: queryDocument now resolves document_id → file_key before chunk lookup.
    // Default to a synthetic completed doc so existing tests still see chunks.
    findOne: jest.fn().mockResolvedValue({
      id: 'doc-001',
      fileKey: 'uploads/doc-001.pdf',
      status: 'completed',
    }),
    ...overrides.docMetaRepo,
  } as unknown as Repository<DocumentMetadata>;

  const chunkRepo = {
    create: jest.fn().mockImplementation((data: unknown) => data),
    save: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
    ...overrides.chunkRepo,
  } as unknown as Repository<DocumentChunk>;

  return new DocumentEngine(
    config as never,
    gateway,
    promptBuilder,
    aiMetrics,
    chunker,
    docMetaRepo,
    chunkRepo,
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DocumentEngine.processDocument', () => {
  describe('batch embedding (happy path)', () => {
    it('calls gateway.embedBatch exactly once (not embed per chunk)', async () => {
      const embedBatch = jest
        .fn()
        .mockResolvedValue([
          makeEmbeddingResult([0.1, 0.2], 10),
          makeEmbeddingResult([0.3, 0.4], 12),
        ]);
      const embed = jest.fn();

      const engine = buildEngine({
        gateway: { embedBatch, embed, complete: jest.fn() },
      });
      const event = makeUploadEvent();

      await engine.processDocument(event, 'some document text');

      expect(embedBatch).toHaveBeenCalledTimes(1);
      expect(embed).not.toHaveBeenCalled();
    });

    it('passes all chunk strings to gateway.embedBatch in a single call', async () => {
      const chunks = ['chunk0', 'chunk1', 'chunk2'];
      const embeddingResults = chunks.map((_, i) =>
        makeEmbeddingResult([i / 10], 8),
      );
      const embedBatch = jest.fn().mockResolvedValue(embeddingResults);

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
      });

      await engine.processDocument(makeUploadEvent(), 'text');

      expect(embedBatch).toHaveBeenCalledWith(
        'user-001',
        chunks,
        'text-embedding-3-small',
        'document',
      );
    });

    it('maps embedBatch results to chunkEntities preserving order and content', async () => {
      const chunks = ['first chunk', 'second chunk'];
      const embeddingResults = [
        makeEmbeddingResult([1, 2], 15),
        makeEmbeddingResult([3, 4], 20),
      ];
      const embedBatch = jest.fn().mockResolvedValue(embeddingResults);
      const chunkRepoCreate = jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => ({ ...data }));
      const chunkRepoSave = jest.fn().mockResolvedValue(undefined);

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        chunkRepo: { create: chunkRepoCreate, save: chunkRepoSave },
      });

      await engine.processDocument(makeUploadEvent(), 'text');

      // Two chunk entities should be created, one per chunk
      expect(chunkRepoCreate).toHaveBeenCalledTimes(2);

      expect(chunkRepoCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          chunkIndex: 0,
          content: 'first chunk',
          embedding: JSON.stringify([1, 2]),
          tokenCount: 15,
        }),
      );
      expect(chunkRepoCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          chunkIndex: 1,
          content: 'second chunk',
          embedding: JSON.stringify([3, 4]),
          tokenCount: 20,
        }),
      );
    });

    it('writes chunks keyed by file_key only — no longer dual-writes document_id (M3)', async () => {
      const expectedFileKey = 'uploads/shared/file-abc.pdf';
      const chunks = ['a', 'b', 'c'];
      const embedBatch = jest
        .fn()
        .mockResolvedValue([
          makeEmbeddingResult([0.1], 5),
          makeEmbeddingResult([0.2], 5),
          makeEmbeddingResult([0.3], 5),
        ]);
      const chunkRepoCreate = jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => ({ ...data }));

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        chunkRepo: { create: chunkRepoCreate, save: jest.fn() },
      });

      await engine.processDocument(
        makeUploadEvent({
          document_id: 'doc-meta-only',
          file_key: expectedFileKey,
        }),
        'text',
      );

      expect(chunkRepoCreate).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) {
        expect(chunkRepoCreate).toHaveBeenNthCalledWith(
          i + 1,
          expect.objectContaining({
            fileKey: expectedFileKey,
            chunkIndex: i,
          }),
        );
      }

      // M3 invariant: documentId is no longer part of the chunk row.
      // Belt-and-suspenders: every chunk shares the SAME file_key (catches a
      // regression where someone appends an index or per-chunk salt).
      const calls = chunkRepoCreate.mock.calls as Array<
        [{ fileKey: string; documentId?: string }]
      >;
      for (const [arg] of calls) {
        expect(arg).not.toHaveProperty('documentId');
      }
      const fileKeys = calls.map(([arg]) => arg.fileKey);
      expect(new Set(fileKeys).size).toBe(1);
      expect(fileKeys[0]).toBe(expectedFileKey);
    });

    it('fails the ingest fail-loud when event.file_key is empty (M3 — column is NOT NULL, no API spend)', async () => {
      const embedBatch = jest.fn();
      const chunker = jest.fn();
      const chunkRepoCreate = jest.fn();
      const docMetaRepoUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const engine = buildEngine({
        chunker: { chunk: chunker },
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        chunkRepo: { create: chunkRepoCreate, save: jest.fn() },
        docMetaRepo: {
          create: jest.fn().mockImplementation((d: unknown) => d),
          save: jest.fn().mockResolvedValue(undefined),
          update: docMetaRepoUpdate,
        },
      });

      // Force file_key to empty string via cast — mirrors a malformed Kafka
      // event that bypasses class-validator at runtime.
      const result = await engine.processDocument(
        makeUploadEvent({ file_key: '' as unknown as string }),
        'text',
      );

      // The guard runs up-front, so the malformed event short-circuits
      // BEFORE the expensive side effects: no chunking and — critically —
      // no embedding API spend. (docMetaRepo.update is still called by
      // recordDocumentFailure to flip status to 'failed'; that's expected.)
      expect(chunker).not.toHaveBeenCalled();
      expect(embedBatch).not.toHaveBeenCalled();
      expect(chunkRepoCreate).not.toHaveBeenCalled();
      // The metadata transition is ONLY the failure marker, not the regular
      // 'processing' transition that would precede chunking.
      expect(docMetaRepoUpdate).toHaveBeenCalledTimes(1);
      expect(docMetaRepoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-001' }),
        expect.objectContaining({ status: 'failed' }),
      );
      expect(result.status).toBe('failed');
      expect(result.error_message).toMatch(/file_key/i);
    });

    it('sums tokensUsed from all embedBatch results as totalTokens', async () => {
      const embeddingResults = [
        makeEmbeddingResult([0.1], 10),
        makeEmbeddingResult([0.2], 20),
        makeEmbeddingResult([0.3], 30),
      ];
      const chunks = ['a', 'b', 'c'];
      const embedBatch = jest.fn().mockResolvedValue(embeddingResults);
      const docMetaRepoUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        docMetaRepo: {
          create: jest.fn().mockImplementation((d: unknown) => d),
          save: jest.fn().mockResolvedValue(undefined),
          update: docMetaRepoUpdate,
        },
      });

      const result = await engine.processDocument(makeUploadEvent(), 'text');

      expect(result.total_tokens).toBe(60);
      expect(docMetaRepoUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ totalTokens: 60 }),
      );
    });

    it('returns a completed AiDocumentProcessedEvent with correct metadata', async () => {
      const embedBatch = jest
        .fn()
        .mockResolvedValue([
          makeEmbeddingResult([0.5], 5),
          makeEmbeddingResult([0.6], 5),
        ]);
      const engine = buildEngine({
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
      });
      const event = makeUploadEvent({ document_id: 'doc-xyz' });

      const result = await engine.processDocument(event, 'some text');

      expect(result.status).toBe('completed');
      expect(result.document_id).toBe('doc-xyz');
      expect(result.chunk_count).toBe(2); // default chunker returns 2 chunks
    });
  });

  describe('error handling', () => {
    it('returns a failed event and records failure when embedBatch throws', async () => {
      const embedBatch = jest.fn().mockRejectedValue(new Error('API down'));
      const aiMetricsRecordRequest = jest.fn();
      const docMetaRepoUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const engine = buildEngine({
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        aiMetrics: { recordRequest: aiMetricsRecordRequest },
        docMetaRepo: {
          create: jest.fn().mockImplementation((d: unknown) => d),
          save: jest.fn().mockResolvedValue(undefined),
          update: docMetaRepoUpdate,
        },
      });

      const result = await engine.processDocument(makeUploadEvent(), 'text');

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('API down');
      // Metrics should be recorded as failure
      expect(aiMetricsRecordRequest).toHaveBeenCalledWith(
        'document_analysis',
        'openai',
        expect.any(String),
        0,
        0,
        0,
        false,
      );
    });

    it('rejects immediately when file_size exceeds the configured limit', async () => {
      const embedBatch = jest.fn();
      const engine = buildEngine({
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        config: { aiMaxDocumentSizeMb: 1 },
      });

      const event = makeUploadEvent({ file_size: 2 * 1024 * 1024 }); // 2 MB
      const result = await engine.processDocument(event, 'text');

      expect(result.status).toBe('failed');
      expect(embedBatch).not.toHaveBeenCalled();
    });
  });

  describe('pending row contract with media-service', () => {
    it('transitions an existing pending row via update() (no fallback insert)', async () => {
      const embedBatch = jest
        .fn()
        .mockResolvedValue([
          makeEmbeddingResult([0.1], 5),
          makeEmbeddingResult([0.2], 5),
        ]);
      const docMetaCreate = jest.fn().mockImplementation((d: unknown) => d);
      const docMetaSave = jest.fn().mockResolvedValue(undefined);
      const docMetaUpdate = jest.fn().mockResolvedValue({ affected: 1 });

      const engine = buildEngine({
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        docMetaRepo: {
          create: docMetaCreate,
          save: docMetaSave,
          update: docMetaUpdate,
        },
      });

      await engine.processDocument(
        makeUploadEvent({ document_id: 'doc-pending-1' }),
        'text',
      );

      // First call updates status pending → processing
      expect(docMetaUpdate).toHaveBeenCalledWith(
        { id: 'doc-pending-1' },
        { status: 'processing' },
      );
      // No fallback insert because update affected a row
      expect(docMetaSave).not.toHaveBeenCalled();
    });

    it('falls back to insert when the pending row is missing (legacy/replay)', async () => {
      const embedBatch = jest
        .fn()
        .mockResolvedValue([
          makeEmbeddingResult([0.1], 5),
          makeEmbeddingResult([0.2], 5),
        ]);
      const docMetaCreate = jest.fn().mockImplementation((d: unknown) => d);
      const docMetaSave = jest.fn().mockResolvedValue(undefined);
      // First call (status='processing' transition) finds no row.
      // Second call (status='completed') affects the row we just inserted.
      const docMetaUpdate = jest
        .fn()
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValue({ affected: 1 });

      const engine = buildEngine({
        gateway: { embedBatch, embed: jest.fn(), complete: jest.fn() },
        docMetaRepo: {
          create: docMetaCreate,
          save: docMetaSave,
          update: docMetaUpdate,
        },
      });

      await engine.processDocument(
        makeUploadEvent({ document_id: 'doc-replay-1' }),
        'text',
      );

      // Fallback insert fired with status='processing'
      expect(docMetaSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc-replay-1',
          status: 'processing',
        }),
      );
    });
  });
});

describe('DocumentEngine.queryDocument', () => {
  function makeQueryEvent(
    overrides: Partial<AiDocumentQueryEvent> = {},
  ): AiDocumentQueryEvent {
    return {
      document_id: 'doc-001',
      conversation_id: 'conv-001',
      user_id: 'user-001',
      query: 'What is the main topic?',
      requested_at: Date.now(),
      ...overrides,
    };
  }

  function makeQueryBuilder(
    rawSimilarity = '0.9',
    chunkContent = 'Chunk text',
  ) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({
        raw: [{ similarity: rawSimilarity }],
        entities: [{ content: chunkContent, chunkIndex: 0 }],
      }),
    };
    return qb;
  }

  it('passes embeddingModel predicate to query builder to prevent dimension mismatch', async () => {
    const qb = makeQueryBuilder();
    const embed = jest.fn().mockResolvedValue({
      embedding: [0.1, 0.2],
      tokensUsed: 5,
      model: 'text-embedding-3-small',
      provider: 'openai',
    });
    const complete = jest.fn().mockResolvedValue({
      content: JSON.stringify({ answer: 'The answer', source_indices: [0] }),
      tokensIn: 20,
      tokensOut: 10,
      model: 'gpt-4o',
      provider: 'openai',
      latencyMs: 150,
    });

    const engine = buildEngine({
      gateway: { embed, complete, embedBatch: jest.fn() },
      chunkRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        create: jest.fn(),
        save: jest.fn(),
      },
    });

    await engine.queryDocument(makeQueryEvent());

    expect(qb.andWhere).toHaveBeenCalledWith(
      'chunk.embeddingModel = :embeddingModel',
      { embeddingModel: 'text-embedding-3-small' },
    );
  });

  it('queries chunks by file_key (M2 reader switch) — not document_id', async () => {
    const qb = makeQueryBuilder();
    const embed = jest.fn().mockResolvedValue({
      embedding: [0.1, 0.2],
      tokensUsed: 5,
      model: 'text-embedding-3-small',
      provider: 'openai',
    });
    const complete = jest.fn().mockResolvedValue({
      content: JSON.stringify({ answer: 'OK', source_indices: [0] }),
      tokensIn: 5,
      tokensOut: 5,
      model: 'gpt-4o',
      provider: 'openai',
      latencyMs: 50,
    });
    const findOne = jest.fn().mockResolvedValue({
      id: 'doc-xyz',
      fileKey: 'uploads/shared-file.pdf',
      status: 'completed',
    });

    const engine = buildEngine({
      gateway: { embed, complete, embedBatch: jest.fn() },
      chunkRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        create: jest.fn(),
        save: jest.fn(),
      },
      docMetaRepo: {
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        findOne,
      },
    });

    await engine.queryDocument(makeQueryEvent({ document_id: 'doc-xyz' }));

    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'doc-xyz', userId: 'user-001' },
    });
    expect(qb.where).toHaveBeenCalledWith('chunk.file_key = :fileKey', {
      fileKey: 'uploads/shared-file.pdf',
    });
  });

  it('M2 — denies access when document belongs to another user (findOne(id+userId) returns null)', async () => {
    const embed = jest.fn();
    // findOne filters by both id AND userId, so a doc owned by another user
    // returns null. Confirms the AiDocumentQuery path enforces the same
    // access check as the Zai chat path (DocumentRagService).
    const findOne = jest.fn().mockResolvedValue(null);

    const engine = buildEngine({
      gateway: { embed, complete: jest.fn(), embedBatch: jest.fn() },
      docMetaRepo: {
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        findOne,
      },
    });

    const result = await engine.queryDocument(
      makeQueryEvent({
        document_id: 'doc-someone-else',
        user_id: 'attacker-user',
      }),
    );

    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'doc-someone-else', userId: 'attacker-user' },
    });
    expect(embed).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
  });

  it('returns empty chunks when DocumentMetadata is missing (M2 — soft fallback, no throw)', async () => {
    const embed = jest.fn();
    const findOne = jest.fn().mockResolvedValue(null);

    const engine = buildEngine({
      gateway: { embed, complete: jest.fn(), embedBatch: jest.fn() },
      docMetaRepo: {
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        findOne,
      },
    });

    const result = await engine.queryDocument(
      makeQueryEvent({ document_id: 'doc-gone' }),
    );

    expect(findOne).toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled(); // skipped — no doc, no embedding spend
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('No content was found');
  });

  it('returns fallback answer when gateway.embed throws', async () => {
    const embed = jest.fn().mockRejectedValue(new Error('Embed API down'));

    const engine = buildEngine({
      gateway: { embed, complete: jest.fn(), embedBatch: jest.fn() },
      chunkRepo: {
        createQueryBuilder: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      },
    });

    const result = await engine.queryDocument(makeQueryEvent());

    expect(result.answer).toContain('Failed to query document');
    expect(result.sources).toEqual([]);
    expect(result.tokens_used).toBe(0);
  });
});
