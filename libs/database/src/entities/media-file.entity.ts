import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';

export type MediaFileStatus = 'pending' | 'uploaded' | 'deleted';

@Entity('media_files')
export class MediaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500, unique: true })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  bucket: string;

  @Column({ type: 'varchar', length: 100, name: 'content_type' })
  contentType: string;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes: number | null;

  @Column({ type: 'uuid', name: 'uploaded_by', nullable: true })
  @Index()
  uploadedById: string | null;

  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: MediaFileStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamp', name: 'uploaded_at', nullable: true })
  uploadedAt: Date | null;

  @ManyToOne(() => User, (user) => user.uploadedFiles, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy: User | null;

  @ManyToOne(() => Conversation, (conv) => conv.mediaFiles, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation | null;
}
