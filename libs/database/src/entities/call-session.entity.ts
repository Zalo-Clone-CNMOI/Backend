import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
  ValueTransformer,
} from 'typeorm';

const bigintTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('call_sessions')
export class CallSession {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'initiator_id' })
  initiatorId: string;

  @Column({ type: 'varchar', length: 10, name: 'call_type' })
  callType: 'audio' | 'video';

  @Column({ type: 'varchar', length: 10, name: 'conversation_type' })
  conversationType: 'direct' | 'group';

  @Column({ type: 'varchar', length: 20 })
  status: 'completed' | 'missed' | 'rejected' | 'timeout';

  @Column({ type: 'bigint', name: 'started_at', transformer: bigintTransformer })
  startedAt: number;

  @Column({ type: 'bigint', name: 'ended_at', nullable: true, transformer: bigintTransformer })
  endedAt: number | null;

  @Column({ type: 'int', name: 'duration_ms', nullable: true })
  durationMs: number | null;

  @Column({ type: 'jsonb', name: 'participant_ids' })
  participantIds: string[];

  @Column({ type: 'varchar', length: 50, nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
