import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@libs/shared';
import { GroupInviteStatus } from '@app/constant';
import { Conversation } from './conversation.entity';
import { User } from './user.entity';

@Entity('conversation_invites')
export class ConversationInvite extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  @Index()
  conversationId: string;

  @Column({ type: 'uuid', name: 'invited_user_id' })
  @Index()
  invitedUserId: string;

  @Column({ type: 'uuid', name: 'inviter_user_id' })
  @Index()
  inviterUserId: string;

  @Column({
    type: 'enum',
    enum: GroupInviteStatus,
    default: GroupInviteStatus.PENDING,
  })
  @Index()
  status: GroupInviteStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message: string | null;

  @Column({ type: 'uuid', name: 'message_id', nullable: true })
  @Index()
  messageId: string | null;

  @Column({ type: 'timestamp', name: 'expires_at' })
  @Index()
  expiresAt: Date;

  @Column({ type: 'timestamp', name: 'responded_at', nullable: true })
  respondedAt: Date | null;

  @ManyToOne(() => Conversation, (conversation) => conversation.invites, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, (user) => user.receivedGroupInvites, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invited_user_id' })
  invitedUser: User;

  @ManyToOne(() => User, (user) => user.sentGroupInvites, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'inviter_user_id' })
  inviterUser: User;
}
