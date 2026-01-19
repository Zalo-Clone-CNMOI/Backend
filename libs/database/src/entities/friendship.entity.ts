import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { BaseEntity } from 'libs/shared/src';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

@Entity('friendships')
@Unique(['requesterId', 'addresseeId'])
export class Friendship extends BaseEntity {
  @Column({ type: 'uuid', name: 'requester_id' })
  requesterId: string;

  @Column({ type: 'uuid', name: 'addressee_id' })
  addresseeId: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index()
  status: FriendshipStatus;

  // Relations
  @ManyToOne(() => User, (user) => user.sentFriendRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'requester_id' })
  requester: User;

  @ManyToOne(() => User, (user) => user.receivedFriendRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'addressee_id' })
  addressee: User;
}
