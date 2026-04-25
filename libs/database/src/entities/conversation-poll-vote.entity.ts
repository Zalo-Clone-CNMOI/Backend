import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ConversationPoll } from './conversation-poll.entity';
import { ConversationPollOption } from './conversation-poll-option.entity';

@Entity('conversation_poll_votes')
@Unique('UQ_poll_votes_option_user', ['optionId', 'userId'])
@Index('IDX_poll_votes_poll_user', ['pollId', 'userId'])
@Index('IDX_poll_votes_poll', ['pollId'])
@Index('IDX_poll_votes_option', ['optionId'])
export class ConversationPollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'poll_id' })
  pollId: string;

  @ManyToOne(() => ConversationPoll, (poll) => poll.votes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'poll_id' })
  poll: ConversationPoll;

  @Column({ type: 'uuid', name: 'option_id' })
  optionId: string;

  @ManyToOne(() => ConversationPollOption, (option) => option.votes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'option_id' })
  option: ConversationPollOption;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ type: 'timestamp', name: 'voted_at' })
  votedAt: Date;
}
