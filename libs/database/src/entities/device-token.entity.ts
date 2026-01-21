import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from '@libs/shared';

@Entity('device_tokens')
@Unique(['userId', 'token'])
export class DeviceToken extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 500 })
  @Index()
  token: string;

  @Column({ type: 'varchar', length: 20 })
  platform: 'ios' | 'android' | 'web';

  @Column({ type: 'varchar', length: 255, name: 'device_id', nullable: true })
  deviceId: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  // Relations
  @ManyToOne(() => User, (user) => user.deviceTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
