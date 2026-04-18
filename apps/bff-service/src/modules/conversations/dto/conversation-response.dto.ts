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

  @ApiProperty({ description: 'Member count' })
  memberCount: number;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
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
    lastReadAt: Date | null;
  };

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}

export class ConversationCallStateSnapshotDto {
  @ApiProperty({ description: 'Call ID' })
  call_id: string;

  @ApiProperty({ description: 'Conversation ID' })
  conversation_id: string;

  @ApiProperty({ description: 'Call type', enum: ['audio', 'video'] })
  call_type: 'audio' | 'video';

  @ApiProperty({
    description: 'Current call status',
    enum: ['ringing', 'ongoing', 'ended'],
  })
  status: 'ringing' | 'ongoing' | 'ended';

  @ApiProperty({ description: 'Initiator user ID' })
  initiator_id: string;

  @ApiProperty({
    description: 'Participant status map by user ID',
    type: 'object',
    additionalProperties: {
      type: 'string',
      enum: ['invited', 'accepted', 'rejected', 'left'],
    },
  })
  participants: Record<string, 'invited' | 'accepted' | 'rejected' | 'left'>;

  @ApiProperty({ description: 'Start timestamp (ms)' })
  started_at: number;

  @ApiPropertyOptional({ description: 'End timestamp (ms)' })
  ended_at?: number;
}

export class ConversationCallStateResponseDto {
  @ApiProperty({ description: 'Conversation ID' })
  conversation_id: string;

  @ApiPropertyOptional({
    description: 'Current active call state; null when no active call',
    type: ConversationCallStateSnapshotDto,
    nullable: true,
  })
  state: ConversationCallStateSnapshotDto | null;

  @ApiProperty({ description: 'Response timestamp (ms)' })
  updated_at: number;

  @ApiPropertyOptional({ description: 'Optional state reason' })
  reason?: string;
}
