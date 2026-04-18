import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Conversation member response
 */
export class ConversationMemberResponseDto {
  @ApiProperty({ description: 'Member ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Full name' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Role in conversation' })
  role: string;

  @ApiPropertyOptional({ description: 'Nickname in conversation' })
  nickname: string | null;

  @ApiProperty({ description: 'Joined at' })
  joinedAt: Date;
}

export class LastMessageDto {
  @ApiProperty({ description: 'Message ID' })
  message_id: string;

  @ApiProperty({ description: 'Message content' })
  body: string;

  @ApiProperty({ description: 'Sender ID' })
  sender_id: string;

  @ApiProperty({ description: 'Created at' })
  created_at: string;

  @ApiProperty({ description: 'Has attachments' })
  has_attachments: boolean;

  @ApiProperty({
    description: 'Message preview type',
    enum: [
      'text',
      'image',
      'video',
      'audio',
      'document',
      'mixed',
      'deleted',
      'unknown',
    ],
  })
  message_type:
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'mixed'
    | 'deleted'
    | 'unknown';
}

/**
 * Conversation list item response
 */
export class ConversationListItemDto {
  @ApiProperty({ description: 'Conversation ID' })
  id: string;

  @ApiProperty({ description: 'Conversation type', enum: ['direct', 'group'] })
  type: 'direct' | 'group';

  @ApiPropertyOptional({ description: 'Conversation name (for groups)' })
  name: string | null;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiPropertyOptional({ description: 'Last message preview' })
  lastMessage: {
    id: string;
    content: string;
    type:
      | 'text'
      | 'image'
      | 'video'
      | 'audio'
      | 'document'
      | 'mixed'
      | 'deleted'
      | 'unknown';
    senderId: string;
    senderName: string;
    createdAt: Date;
  } | null;

  @ApiProperty({ description: 'Unread message count' })
  unreadCount: number;

  @ApiPropertyOptional({ description: 'Last message timestamp' })
  lastMessageAt: Date | null;

  @ApiProperty({ description: 'Whether notifications are muted' })
  isMuted: boolean;

  @ApiProperty({
    description: 'Whether conversation is pinned for current user',
  })
  isPinned: boolean;

  @ApiPropertyOptional({ description: 'Pinned timestamp for current user' })
  pinnedAt: Date | null;

  @ApiProperty({ description: 'Member count' })
  memberCount: number;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Last message' })
  last_message?: LastMessageDto | null;
}

/**
 * Conversation detail response
 */
export class ConversationDetailDto {
  @ApiProperty({ description: 'Conversation ID' })
  id: string;

  @ApiProperty({ description: 'Conversation type', enum: ['direct', 'group'] })
  type: 'direct' | 'group';

  @ApiPropertyOptional({ description: 'Conversation name (for groups)' })
  name: string | null;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiPropertyOptional({ description: 'Created by user ID' })
  createdById: string | null;

  @ApiProperty({
    description: 'Members',
    type: [ConversationMemberResponseDto],
  })
  members: ConversationMemberResponseDto[];

  @ApiProperty({ description: 'Current user settings in this conversation' })
  mySettings: {
    role: string;
    nickname: string | null;
    isMuted: boolean;
    isPinned: boolean;
    pinnedAt: Date | null;
    lastReadAt: Date | null;
  };

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}
