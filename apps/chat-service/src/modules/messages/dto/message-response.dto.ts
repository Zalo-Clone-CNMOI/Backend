import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttachmentResponseDto {
  @ApiProperty({ description: 'S3 key' })
  key: string;

  @ApiProperty({
    description: 'Attachment type',
    enum: ['image', 'video', 'audio', 'document'],
  })
  type: 'image' | 'video' | 'audio' | 'document';

  @ApiProperty({ description: 'Original file name' })
  name: string;

  @ApiProperty({ description: 'File size in bytes' })
  size: number;

  @ApiProperty({ description: 'Content type' })
  contentType: string;

  @ApiPropertyOptional({ description: 'Thumbnail key for images/videos' })
  thumbnailKey?: string;

  @ApiProperty({ description: 'File visibility', enum: ['public', 'private'] })
  visibility: 'public' | 'private';

  @ApiPropertyOptional({ description: 'CDN URL (public files only)' })
  url: string | null;

  @ApiPropertyOptional({ description: 'Thumbnail CDN URL' })
  thumbnailUrl?: string;
}

export class MessageReactionDto {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({
    description: 'Reaction type',
    enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
  })
  reactionType: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: number;
}

export class MessageResponseDto {
  @ApiProperty({ description: 'Message ID' })
  messageId: string;

  @ApiProperty({ description: 'Conversation ID' })
  conversationId: string;

  @ApiProperty({ description: 'Sender ID' })
  senderId: string;

  @ApiProperty({ description: 'Message body' })
  body: string;

  @ApiProperty({ description: 'Created at timestamp (epoch ms)' })
  createdAt: number;

  @ApiPropertyOptional({
    description: 'Attachments',
    type: [AttachmentResponseDto],
  })
  attachments?: AttachmentResponseDto[];

  @ApiPropertyOptional({ description: 'Reply to message ID' })
  replyToMessageId?: string;

  @ApiPropertyOptional({ description: 'Edited at timestamp' })
  editedAt?: number;

  @ApiPropertyOptional({ description: 'Deleted at timestamp' })
  deletedAt?: number;

  @ApiProperty({ description: 'Whether message is deleted' })
  isDeleted: boolean;

  @ApiPropertyOptional({ description: 'Forwarded message metadata' })
  forwardedFrom?: {
    source_message_id: string;
    source_conversation_id: string;
    source_sender_id: string;
    source_sender_name_snapshot: string;
    source_created_at: number;
    source_type: 'text' | 'image' | 'file' | 'mixed';
  };
}

export class MessageListResponseDto {
  @ApiProperty({ description: 'Messages', type: [MessageResponseDto] })
  items: MessageResponseDto[];

  @ApiProperty({ description: 'Next cursor for pagination' })
  nextCursor: string | null;

  @ApiProperty({ description: 'Whether there are more messages' })
  hasMore: boolean;
}

export class ReactionSummaryDto {
  @ApiProperty({ description: 'Reaction type' })
  type: string;

  @ApiProperty({ description: 'Count of this reaction' })
  count: number;

  @ApiProperty({ description: 'User IDs who reacted', type: [String] })
  userIds: string[];
}

export class MessageReactionsResponseDto {
  @ApiProperty({ description: 'Message ID' })
  messageId: string;

  @ApiProperty({ description: 'Reactions', type: [MessageReactionDto] })
  reactions: MessageReactionDto[];

  @ApiProperty({ description: 'Reaction summary', type: [ReactionSummaryDto] })
  summary: ReactionSummaryDto[];
}

export class MessageSearchResponseDto {
  @ApiProperty({ description: 'Matched messages', type: [MessageResponseDto] })
  items: MessageResponseDto[];

  @ApiProperty({ description: 'Total number of matched messages', example: 3 })
  total: number;
}

export class PinnedMessageDto {
  @ApiProperty({ description: 'Message payload', type: MessageResponseDto })
  message: MessageResponseDto;

  @ApiProperty({ description: 'User ID who pinned the message' })
  pinnedBy: string;

  @ApiProperty({ description: 'Pinned timestamp (epoch ms)' })
  pinnedAt: number;
}

export class PinnedMessageListResponseDto {
  @ApiProperty({ description: 'Pinned messages', type: [PinnedMessageDto] })
  items: PinnedMessageDto[];

  @ApiProperty({ description: 'Total pinned messages in this response' })
  total: number;
}
