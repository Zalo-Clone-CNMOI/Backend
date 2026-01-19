import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Post } from './post.entity';
import { BaseEntity } from '@libs/shared';

export type PostMediaType = 'image' | 'video';

@Entity('post_media')
export class PostMedia extends BaseEntity {
  @Column({ type: 'uuid', name: 'post_id' })
  postId: string;

  @Column({ type: 'varchar', length: 500, name: 'media_url' })
  mediaUrl: string;

  @Column({ type: 'varchar', length: 20, name: 'media_type' })
  mediaType: PostMediaType;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'thumbnail_url',
    nullable: true,
  })
  thumbnailUrl: string | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'int', name: 'duration_seconds', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'int', name: 'display_order', default: 0 })
  @Index()
  displayOrder: number;

  @ManyToOne(() => Post, (post) => post.media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;
}
