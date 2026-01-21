import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { FriendshipStatus } from '@app/constant/enum';
import { BaseEntity } from '@libs/shared';


@Entity('friendships')
@Unique(['requesterId', 'addresseeId'])
export class Friendship extends BaseEntity {
  @Column({ type: 'uuid', name: 'requester_id' })
  requesterId: string;

  @Column({ type: 'uuid', name: 'addressee_id' })
  addresseeId: string;

  @Column({
    type: 'enum',
    enum: FriendshipStatus,
    default: FriendshipStatus.PENDING,
  })
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
