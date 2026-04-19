import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupInviteStatus } from '@app/clients/interaction-client';

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

export class GroupInviteItemDto {
  @ApiProperty({ description: 'Invite ID' })
  id: string;

  @ApiProperty({ description: 'Conversation ID' })
  conversationId: string;

  @ApiProperty({ description: 'Inviter user ID' })
  inviterUserId: string;

  @ApiProperty({ description: 'Invited user ID' })
  invitedUserId: string;

  @ApiProperty({ description: 'Invite status' })
  status: GroupInviteStatus;

  @ApiPropertyOptional({ description: 'Optional invite message' })
  message: string | null;

  @ApiProperty({ description: 'Invite expires at' })
  expiresAt: Date;

  @ApiProperty({ description: 'Invite created at' })
  createdAt: Date;

  @ApiPropertyOptional({ description: 'Invite responded at' })
  respondedAt: Date | null;
}

export class SendGroupInvitesResponseDto {
  @ApiProperty({ description: 'Number of invites created' })
  acceptedCount: number;

  @ApiProperty({ description: 'Number of skipped users' })
  skippedCount: number;

  @ApiProperty({ description: 'Created invite IDs', type: [String] })
  inviteIds: string[];
}
