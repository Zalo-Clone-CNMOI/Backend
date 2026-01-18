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
import { MediaFile } from './media-file.entity';
import { ConversationType } from '@app/constant';
import { BaseEntity } from 'libs/shared/src';

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

  // Relations
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @OneToMany(() => ConversationMember, (member) => member.conversation)
  members: ConversationMember[];

  @OneToMany(() => MediaFile, (media) => media.conversation)
  mediaFiles: MediaFile[];
}
