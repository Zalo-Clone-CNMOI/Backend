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

export interface DetectedEntityRecord {
  text: string;
  type: string;
  confidence: number;
}

@Entity('ai_entity_detection_logs')
@Index('idx_ai_entity_conversation', ['conversationId', 'createdAt'])
export class AiEntityDetectionLog extends BaseEntity {
  @Column({ type: 'uuid', name: 'message_id' })
  @Index()
  messageId: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @Column({ type: 'jsonb' })
  entities: DetectedEntityRecord[];

  @Column({ type: 'varchar', length: 20 })
  provider: string;

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
