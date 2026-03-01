import {
  Entity,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from '@libs/shared';

@Entity('ai_moderation_logs')
@Index('idx_ai_moderation_conversation', ['conversationId', 'createdAt'])
@Index('idx_ai_moderation_flagged', ['isFlagged', 'createdAt'])
export class AiModerationLog extends BaseEntity {
  @Column({ type: 'uuid', name: 'message_id' })
  @Index()
  messageId: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @Column({ type: 'boolean', name: 'is_flagged', default: false })
  isFlagged: boolean;

  @Column({ type: 'simple-array', nullable: true })
  labels: string[];

  @Column({ type: 'float', default: 0 })
  confidence: number;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'boolean', default: false })
  ensemble: boolean;

  @Column({ type: 'int', name: 'tokens_used', default: 0 })
  tokensUsed: number;

  @Column({ type: 'varchar', name: 'trace_id', length: 64, nullable: true })
  traceId: string | null;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;
}
