import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { PostComment } from './post-comment.entity';
import { BaseEntity } from 'libs/shared/src';

@Entity('comment_likes')
@Unique(['commentId', 'userId'])
export class CommentLike extends BaseEntity {
  @Column({ type: 'uuid', name: 'comment_id' })
  @Index()
  commentId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => PostComment, (comment) => comment.likes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'comment_id' })
  comment: PostComment;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
