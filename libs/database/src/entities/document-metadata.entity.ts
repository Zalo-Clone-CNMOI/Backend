import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from '@libs/shared';

@Entity('document_metadata')
@Index('idx_document_conversation', ['conversationId'])
@Index('idx_document_user', ['userId'])
// Idempotency + race-protection: at most one DocumentMetadata row per
// (file_key, user_id, conversation_id). Without this, two concurrent
// confirmUploads can both pass `findOne` returning null and INSERT
// duplicate rows that point at the same underlying upload. The unique
// constraint also implicitly creates a composite index that backs the
// idempotency lookup in MediaService.confirmUploaded.
@Unique('uq_document_file_user_conv', ['fileKey', 'userId', 'conversationId'])
export class DocumentMetadata extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', name: 'file_key', length: 512 })
  fileKey: string;

  @Column({ type: 'varchar', name: 'file_name', length: 255 })
  fileName: string;

  @Column({ type: 'int', name: 'file_size' })
  fileSize: number;

  @Column({ type: 'varchar', name: 'content_type', length: 100 })
  contentType: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'int', name: 'chunk_count', default: 0 })
  chunkCount: number;

  @Column({ type: 'int', name: 'total_tokens', default: 0 })
  totalTokens: number;

  @Column({ type: 'int', name: 'page_count', nullable: true })
  pageCount: number | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({
    type: 'varchar',
    name: 'embedding_model',
    length: 50,
    nullable: true,
  })
  embeddingModel: string | null;

  @Column({ type: 'int', name: 'embedding_version', default: 1 })
  embeddingVersion: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
