import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '@libs/shared';
import { ConversationPoll } from './conversation-poll.entity';
import { ConversationPollVote } from './conversation-poll-vote.entity';

@Entity('conversation_poll_options')
@Index('IDX_poll_options_poll', ['pollId'])
export class ConversationPollOption extends BaseEntity {
  @Column({ type: 'uuid', name: 'poll_id' })
  pollId: string;

  @ManyToOne(() => ConversationPoll, (poll) => poll.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'poll_id' })
  poll: ConversationPoll;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Column({ type: 'int', name: 'order_index' })
  orderIndex: number;

  @Column({ type: 'uuid', name: 'added_by_user_id' })
  addedByUserId: string;

  @OneToMany(() => ConversationPollVote, (vote) => vote.option)
  votes: ConversationPollVote[];
}
