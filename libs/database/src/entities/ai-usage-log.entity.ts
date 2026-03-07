import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from '@libs/shared';

@Entity('ai_usage_logs')
@Index('idx_ai_usage_user_date', ['userId', 'createdAt'])
@Index('idx_ai_usage_feature', ['feature', 'createdAt'])
export class AiUsageLog extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  feature: string;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  model: string | null;

  @Column({ type: 'int', name: 'tokens_in', default: 0 })
  tokensIn: number;

  @Column({ type: 'int', name: 'tokens_out', default: 0 })
  tokensOut: number;

  @Column({ type: 'int', name: 'total_tokens', default: 0 })
  totalTokens: number;

  @Column({
    type: 'decimal',
    name: 'estimated_cost_usd',
    precision: 10,
    scale: 6,
    default: 0,
  })
  estimatedCostUsd: number;

  @Column({ type: 'int', name: 'latency_ms', default: 0 })
  latencyMs: number;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', name: 'trace_id', length: 64, nullable: true })
  traceId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
