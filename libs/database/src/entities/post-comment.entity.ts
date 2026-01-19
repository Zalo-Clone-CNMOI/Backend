import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Post } from './post.entity';
import { CommentLike } from './comment-like.entity';
import { BaseEntity } from 'libs/shared/src';

@Entity('post_comments')
export class PostComment extends BaseEntity {
  @Column({ type: 'uuid', name: 'post_id' })
  postId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'uuid', name: 'parent_comment_id', nullable: true })
  @Index()
  parentCommentId: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', name: 'like_count', default: 0 })
  likeCount: number;

  @Column({ type: 'boolean', name: 'is_deleted', default: false })
  isDeleted: boolean;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @ManyToOne(() => User, (user) => user.postComments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => PostComment, (comment) => comment.replies, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'parent_comment_id' })
  parentComment: PostComment | null;

  @OneToMany(() => PostComment, (comment) => comment.parentComment)
  replies: PostComment[];

  @OneToMany(() => CommentLike, (like) => like.comment)
  likes: CommentLike[];
}
