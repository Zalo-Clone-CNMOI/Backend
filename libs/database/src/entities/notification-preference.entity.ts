import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from 'libs/shared/src';

@Entity('notification_preferences')
export class NotificationPreference extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @Column({ type: 'boolean', name: 'push_enabled', default: true })
  pushEnabled: boolean;

  @Column({ type: 'boolean', name: 'sound_enabled', default: true })
  soundEnabled: boolean;

  @Column({ type: 'boolean', name: 'vibrate_enabled', default: true })
  vibrateEnabled: boolean;

  @Column({ type: 'boolean', name: 'show_preview', default: true })
  showPreview: boolean;

  @Column({ type: 'time', name: 'quiet_hours_start', nullable: true })
  quietHoursStart: string | null;

  @Column({ type: 'time', name: 'quiet_hours_end', nullable: true })
  quietHoursEnd: string | null;

  @OneToOne(() => User, (user) => user.notificationPreference, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
