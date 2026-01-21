import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { User } from './user.entity';
import { Post } from './post.entity';
import { ReactionType } from '@app/constant';
import { BaseEntity } from '@libs/shared';

@Entity('post_likes')
@Unique(['postId', 'userId'])
export class PostLike extends BaseEntity {
  @Column({ type: 'uuid', name: 'post_id' })
  @Index()
  postId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'reaction_type',
    default: ReactionType.LIKE,
  })
  reactionType: ReactionType;

  @ManyToOne(() => Post, (post) => post.likes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @ManyToOne(() => User, (user) => user.postLikes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
