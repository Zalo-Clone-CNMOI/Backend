import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { PostMedia } from './post-media.entity';
import { PostLike } from './post-like.entity';
import { PostComment } from './post-comment.entity';
import { BaseEntity } from '@libs/shared';

export type PostVisibility = 'public' | 'friends' | 'only_me';

@Entity('posts')
export class Post extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'varchar', length: 20, default: 'friends' })
  visibility: PostVisibility;

  @Column({ type: 'int', name: 'like_count', default: 0 })
  likeCount: number;

  @Column({ type: 'int', name: 'comment_count', default: 0 })
  commentCount: number;

  @Column({ type: 'int', name: 'share_count', default: 0 })
  shareCount: number;

  @Column({ type: 'boolean', name: 'is_pinned', default: false })
  isPinned: boolean;

  @Column({ type: 'boolean', name: 'is_deleted', default: false })
  isDeleted: boolean;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => PostMedia, (media) => media.post)
  media: PostMedia[];

  @OneToMany(() => PostLike, (like) => like.post)
  likes: PostLike[];

  @OneToMany(() => PostComment, (comment) => comment.post)
  comments: PostComment[];
}
