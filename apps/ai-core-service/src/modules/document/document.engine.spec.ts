import { DocumentEngine } from './document.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { OpenAiProvider } from '../ai-gateway/providers/openai.provider';
import { TextChunkerService } from './text-chunker.service';
import { Repository } from 'typeorm';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import type { AiDocumentUploadEvent } from '@libs/contracts';
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

function buildEngine(overrides: {
  gateway?: Partial<AiGatewayService>;
  promptBuilder?: Partial<PromptBuilderService>;
  aiMetrics?: Partial<AiMetricsService>;
  openaiProvider?: Partial<OpenAiProvider>;
  chunker?: Partial<TextChunkerService>;
  docMetaRepo?: Partial<Repository<DocumentMetadata>>;
  chunkRepo?: Partial<Repository<DocumentChunk>>;
  config?: Record<string, unknown>;
} = {}) {
  const config = {
    aiMaxDocumentSizeMb: 10,
    aiMaxDocumentPages: 200,
    aiEmbeddingModel: 'text-embedding-3-small',
    ...overrides.config,
  };

  const gateway = {
    complete: jest.fn(),
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

  const openaiProvider = {
    embed: jest.fn(),
    embedBatch: jest.fn(),
    ...overrides.openaiProvider,
  } as unknown as OpenAiProvider;

  const chunker = {
    chunk: jest.fn().mockResolvedValue(['chunk0', 'chunk1']),
    ...overrides.chunker,
  } as unknown as TextChunkerService;

  const docMetaRepo = {
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides.docMetaRepo,
  } as unknown as Repository<DocumentMetadata>;

  const chunkRepo = {
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
    ...overrides.chunkRepo,
  } as unknown as Repository<DocumentChunk>;

  return new DocumentEngine(
    config as never,
    gateway,
    promptBuilder,
    aiMetrics,
    openaiProvider,
    chunker,
    docMetaRepo,
    chunkRepo,
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DocumentEngine.processDocument', () => {
  describe('batch embedding (happy path)', () => {
    it('calls embedBatch exactly once (not embed per chunk)', async () => {
      const embedBatch = jest.fn().mockResolvedValue([
        makeEmbeddingResult([0.1, 0.2], 10),
        makeEmbeddingResult([0.3, 0.4], 12),
      ]);
      const embed = jest.fn();

      const engine = buildEngine({ openaiProvider: { embedBatch, embed } });
      const event = makeUploadEvent();

      await engine.processDocument(event, 'some document text');

      expect(embedBatch).toHaveBeenCalledTimes(1);
      expect(embed).not.toHaveBeenCalled();
    });

    it('passes all chunk strings to embedBatch in a single call', async () => {
      const chunks = ['chunk0', 'chunk1', 'chunk2'];
      const embeddingResults = chunks.map((_, i) =>
        makeEmbeddingResult([i / 10], 8),
      );
      const embedBatch = jest.fn().mockResolvedValue(embeddingResults);

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        openaiProvider: { embedBatch, embed: jest.fn() },
      });

      await engine.processDocument(makeUploadEvent(), 'text');

      expect(embedBatch).toHaveBeenCalledWith(
        chunks,
        'text-embedding-3-small',
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
        .mockImplementation((data) => ({ ...data }));
      const chunkRepoSave = jest.fn().mockResolvedValue(undefined);

      const engine = buildEngine({
        chunker: { chunk: jest.fn().mockResolvedValue(chunks) },
        openaiProvider: { embedBatch, embed: jest.fn() },
        chunkRepo: { create: chunkRepoCreate, save: chunkRepoSave },
      });

      await engine.processDocument(makeUploadEvent(), 'text');

      // Two chunk entities should be created, one per chunk
      expect(chunkRepoCreate).toHaveBeenCalledTimes(2);

      const [call0, call1] = chunkRepoCreate.mock.calls;
      expect(call0[0]).toMatchObject({
        chunkIndex: 0,
        content: 'first chunk',
        embedding: JSON.stringify([1, 2]),
        tokenCount: 15,
      });
      expect(call1[0]).toMatchObject({
        chunkIndex: 1,
        content: 'second chunk',
        embedding: JSON.stringify([3, 4]),
        tokenCount: 20,
      });
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
        openaiProvider: { embedBatch, embed: jest.fn() },
        docMetaRepo: {
          create: jest.fn().mockImplementation((d) => d),
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
      const embedBatch = jest.fn().mockResolvedValue([
        makeEmbeddingResult([0.5], 5),
        makeEmbeddingResult([0.6], 5),
      ]);
      const engine = buildEngine({
        openaiProvider: { embedBatch, embed: jest.fn() },
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
        openaiProvider: { embedBatch, embed: jest.fn() },
        aiMetrics: { recordRequest: aiMetricsRecordRequest },
        docMetaRepo: {
          create: jest.fn().mockImplementation((d) => d),
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
        openaiProvider: { embedBatch, embed: jest.fn() },
        config: { aiMaxDocumentSizeMb: 1 },
      });

      const event = makeUploadEvent({ file_size: 2 * 1024 * 1024 }); // 2 MB
      const result = await engine.processDocument(event, 'text');

      expect(result.status).toBe('failed');
      expect(embedBatch).not.toHaveBeenCalled();
    });
  });
});
