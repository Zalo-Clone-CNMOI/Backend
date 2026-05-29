import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@libs/shared';

/**
 * DocumentChunk stores text chunks with their vector embeddings.
 *
 * Scoping: chunks are keyed by `file_key` (the stable S3 object key),
 * NOT by per-user/per-conversation document_id. One file → one set of
 * chunks → shared across every DocumentMetadata row that points at it.
 * Access control lives in DocumentMetadata (id+userId lookups in readers).
 *
 * NOTE: The `embedding` column uses pgvector `vector(1024)` type (voyage-3).
 * It was originally vector(1536) for OpenAI text-embedding-3-small and was
 * resized in migration 1783000000000-resize-embedding-vector-1024.
 * A TypeORM migration MUST be run to:
 *   1. CREATE EXTENSION IF NOT EXISTS vector;
 *   2. Create this table with the vector column
 *   3. CREATE INDEX using IVFFlat / HNSW on the embedding column
 *
 * TypeORM's `synchronize` will NOT handle vector columns correctly.
 * The column type is stored as 'text' here for TypeORM compatibility;
 * the actual column type is managed via migration.
 */
@Entity('document_chunks')
@Index('idx_chunk_file_key', ['fileKey'])
export class DocumentChunk extends BaseEntity {
  /**
   * Stable S3 object key — the canonical scope for this chunk. Multiple
   * DocumentMetadata rows (one per user/conversation that has access to
   * the file) can dereference the same chunks via this column.
   */
  @Column({ type: 'varchar', name: 'file_key', length: 512 })
  fileKey: string;

  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', name: 'token_count', default: 0 })
  tokenCount: number;

  /**
   * Vector embedding stored as text for TypeORM entity definition.
   * Actual DB column type: vector(1024) — managed via migration.
   * Store as JSON string '[0.1, 0.2, ...]' and cast in queries.
   */
  @Column({ type: 'text', nullable: true })
  embedding: string | null;

  @Column({
    type: 'varchar',
    name: 'embedding_model',
    length: 50,
    nullable: true,
  })
  embeddingModel: string | null;

  @Column({ type: 'int', name: 'embedding_version', default: 1 })
  embeddingVersion: number;

  @Column({ type: 'int', name: 'page_number', nullable: true })
  pageNumber: number | null;
}
