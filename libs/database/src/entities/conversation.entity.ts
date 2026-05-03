import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { ConversationMember } from './conversation-member.entity';
import { ConversationInvite } from './conversation-invite.entity';
import { ConversationPoll } from './conversation-poll.entity';
import { MediaFile } from './media-file.entity';
import {
  ConversationType,
  GroupSettings,
  DEFAULT_GROUP_SETTINGS,
} from '@app/constant';
import { BaseEntity } from '@libs/shared';

@Entity('conversations')
export class Conversation extends BaseEntity {
  @Column({ type: 'varchar', length: 20, default: 'direct' })
  type: ConversationType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 500, name: 'avatar_url', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @Column({ type: 'uuid', name: 'last_message_id', nullable: true })
  lastMessageId: string | null;

  @Column({ type: 'timestamp', name: 'last_message_at', nullable: true })
  @Index()
  lastMessageAt: Date | null;

  // null for direct conversations; always populated for group conversations
  @Column({
    type: 'jsonb',
    name: 'settings',
    nullable: true,
    default: () => `'${JSON.stringify(DEFAULT_GROUP_SETTINGS)}'`,
  })
  settings: GroupSettings | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @OneToMany(() => ConversationMember, (member) => member.conversation)
  members: ConversationMember[];

  @OneToMany(() => ConversationInvite, (invite) => invite.conversation)
  invites: ConversationInvite[];

  @OneToMany(() => ConversationPoll, (poll) => poll.conversation)
  polls: ConversationPoll[];

  @OneToMany(() => MediaFile, (media) => media.conversation)
  mediaFiles: MediaFile[];
}
