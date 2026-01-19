import { Entity, Column, Index, OneToMany, OneToOne } from 'typeorm';
import { DeviceToken } from './device-token.entity';
import { ConversationMember } from './conversation-member.entity';
import { Friendship } from './friendship.entity';
import { MediaFile } from './media-file.entity';
import { Post } from './post.entity';
import { PostLike } from './post-like.entity';
import { PostComment } from './post-comment.entity';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationLog } from './notification-log.entity';
import { UserStatus } from '@app/constant';
import { BaseEntity } from 'libs/shared/src';

@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 20, unique: true })
  @Index()
  phone: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  @Index()
  email: string | null;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255, name: 'full_name' })
  fullName: string;

  @Column({ type: 'varchar', length: 500, name: 'avatar_url', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: string | null;

  @Column({ type: 'date', name: 'date_of_birth', nullable: true })
  dateOfBirth: Date | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  @Index()
  status: UserStatus;

  @Column({ type: 'timestamp', name: 'last_seen_at', nullable: true })
  lastSeenAt: Date | null;

  @OneToMany(() => DeviceToken, (deviceToken) => deviceToken.user)
  deviceTokens: DeviceToken[];

  @OneToMany(() => ConversationMember, (member) => member.user)
  conversationMemberships: ConversationMember[];

  @OneToMany(() => Friendship, (friendship) => friendship.requester)
  sentFriendRequests: Friendship[];

  @OneToMany(() => Friendship, (friendship) => friendship.addressee)
  receivedFriendRequests: Friendship[];

  @OneToMany(() => MediaFile, (media) => media.uploadedBy)
  uploadedFiles: MediaFile[];

  @OneToMany(() => Post, (post) => post.user)
  posts: Post[];

  @OneToMany(() => PostLike, (like) => like.user)
  postLikes: PostLike[];

  @OneToMany(() => PostComment, (comment) => comment.user)
  postComments: PostComment[];

  @OneToOne(() => NotificationPreference, (pref) => pref.user)
  notificationPreference: NotificationPreference;

  @OneToMany(() => NotificationLog, (log) => log.user)
  notificationLogs: NotificationLog[];
}
