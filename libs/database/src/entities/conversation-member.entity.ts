import {
  Entity,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';
import { BaseEntity } from '@libs/shared';
import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';

@Entity('conversation_members')
@Unique(['conversationId', 'userId'])
export class ConversationMember extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  @Index()
  conversationId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: UpdateMemberRoleDtoRoleEnum,
    default: UpdateMemberRoleDtoRoleEnum.MEMBER,
  })
  role: UpdateMemberRoleDtoRoleEnum;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string | null;

  @Column({ type: 'boolean', name: 'is_muted', default: false })
  isMuted: boolean;

  @Column({ type: 'timestamp', name: 'last_read_at', nullable: true })
  lastReadAt: Date | null;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @Column({ type: 'timestamp', name: 'left_at', nullable: true })
  @Index()
  leftAt: Date | null;

  // Relations
  @ManyToOne(() => Conversation, (conv) => conv.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, (user) => user.conversationMemberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
