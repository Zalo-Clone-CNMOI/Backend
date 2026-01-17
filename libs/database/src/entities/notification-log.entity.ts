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

export type NotificationChannel = 'push' | 'email' | 'sms';
export type NotificationProvider = 'fcm' | 'apns' | 'mock';
export type NotificationStatus = 'sent' | 'failed' | 'pending';

@Entity('notification_logs')
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 50 })
  provider: NotificationProvider;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, string> | null;

  @Column({ type: 'varchar', length: 20 })
  status: NotificationStatus;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'sent_at' })
  @Index()
  sentAt: Date;

  @ManyToOne(() => User, (user) => user.notificationLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
