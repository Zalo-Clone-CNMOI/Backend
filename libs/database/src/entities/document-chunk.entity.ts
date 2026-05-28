import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DocumentMetadata } from './document-metadata.entity';
import { BaseEntity } from '@libs/shared';

/**
 * DocumentChunk stores text chunks with their vector embeddings.
 *
 * NOTE: The `embedding` column uses pgvector `vector(1536)` type.
 * A TypeORM migration MUST be run to:
 *   1. CREATE EXTENSION IF NOT EXISTS vector;
 *   2. Create this table with the vector column
 *   3. CREATE INDEX using IVFFlat on the embedding column
 *
 * TypeORM's `synchronize` will NOT handle vector columns correctly.
 * The column type is stored as 'text' here for TypeORM compatibility;
 * the actual column type is managed via migration.
 */
@Entity('document_chunks')
@Index('idx_chunk_document', ['documentId'])
@Index('idx_chunk_file_key', ['fileKey'])
export class DocumentChunk extends BaseEntity {
  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  /**
   * Stable key used to share chunks across re-uploads/forwards of the same
   * physical file. Nullable during the M1→M3 rollout: M1 backfills + starts
   * dual-write, M2 switches readers to query by file_key, M3 drops
   * document_id and makes this NOT NULL.
   */
  @Column({ type: 'varchar', name: 'file_key', length: 512, nullable: true })
  fileKey: string | null = null;

  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', name: 'token_count', default: 0 })
  tokenCount: number;

  /**
   * Vector embedding stored as text for TypeORM entity definition.
   * Actual DB column type: vector(1536) — managed via migration.
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

  // ON DELETE NO ACTION (not CASCADE) so chunks survive when one of multiple
  // DocumentMetadata rows sharing a file_key is deleted. See M1 migration.
  // KEEP IN SYNC with the FK constraint — `synchronize: true` in dev would
  // otherwise revert the migration's FK swap on service startup.
  @ManyToOne(() => DocumentMetadata, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'document_id' })
  document: DocumentMetadata;
}
