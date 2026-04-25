import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '@libs/shared';
import { PollStatus, PollClosedReason } from '@app/constant';
import { Conversation } from './conversation.entity';
import { User } from './user.entity';
import { ConversationPollOption } from './conversation-poll-option.entity';
import { ConversationPollVote } from './conversation-poll-vote.entity';

@Entity('conversation_polls')
@Index('IDX_polls_conversation', ['conversationId'])
@Index('IDX_polls_creator', ['creatorId'])
@Index('IDX_polls_status', ['status'])
@Index('IDX_polls_expires', ['expiresAt'])
export class ConversationPoll extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.polls, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({ type: 'varchar', length: 500 })
  question: string;

  @Column({ type: 'boolean', name: 'allow_multiple', default: false })
  allowMultiple: boolean;

  @Column({ type: 'boolean', name: 'allow_add_option', default: false })
  allowAddOption: boolean;

  @Column({ type: 'boolean', name: 'is_anonymous', default: false })
  isAnonymous: boolean;

  @Column({
    type: 'enum',
    enum: PollStatus,
    default: PollStatus.ACTIVE,
  })
  status: PollStatus;

  @Column({ type: 'timestamp', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', name: 'closed_at', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', name: 'closed_by_user_id', nullable: true })
  closedByUserId: string | null;

  @Column({
    type: 'enum',
    enum: PollClosedReason,
    name: 'closed_reason',
    nullable: true,
  })
  closedReason: PollClosedReason | null;

  @Column({ type: 'uuid', name: 'message_id', nullable: true })
  messageId: string | null;

  @Column({ type: 'timestamp', name: 'edited_at', nullable: true })
  editedAt: Date | null;

  @OneToMany(() => ConversationPollOption, (option) => option.poll, {
    cascade: true,
  })
  options: ConversationPollOption[];

  @OneToMany(() => ConversationPollVote, (vote) => vote.poll, {
    cascade: true,
  })
  votes: ConversationPollVote[];
}
