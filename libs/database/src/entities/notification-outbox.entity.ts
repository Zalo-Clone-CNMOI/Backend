import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@libs/shared';

@Index('IDX_notification_outbox_producer_next_attempt_at', [
  'producer',
  'nextAttemptAt',
])
@Entity('notification_outbox')
export class NotificationOutbox extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  @Index()
  producer!: string;

  @Column({ type: 'varchar', length: 120 })
  @Index()
  topic!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'int', name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column({ type: 'timestamp', name: 'first_failed_at' })
  firstFailedAt!: Date;

  @Column({ type: 'timestamp', name: 'next_attempt_at' })
  @Index()
  nextAttemptAt!: Date;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;
}
