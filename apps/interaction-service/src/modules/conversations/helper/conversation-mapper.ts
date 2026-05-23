import {
  Conversation,
  ConversationMember,
  ConversationInvite,
} from '@libs/database/entities';
import {
  ConversationType,
  GroupInviteStatus,
  DEFAULT_GROUP_SETTINGS,
  type GroupSettings,
} from '@app/constant';
import {
  ConversationListItemDto,
  ConversationDetailDto,
  ConversationMemberResponseDto,
  GroupInviteItemDto,
} from '../dto';

function normalizeGroupSettings(raw: unknown): GroupSettings {
  const s = (raw ?? {}) as Partial<GroupSettings>;
  return {
    permissions: {
      ...DEFAULT_GROUP_SETTINGS.permissions,
      ...(s.permissions ?? {}),
    },
    policies: { ...DEFAULT_GROUP_SETTINGS.policies, ...(s.policies ?? {}) },
    features: { ...DEFAULT_GROUP_SETTINGS.features, ...(s.features ?? {}) },
  };
}

export interface LastMessage {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  has_attachments: boolean;
  message_type?:
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'mixed'
    | 'deleted'
    | 'unknown';
}

export function toListItem(
  conversation: Conversation,
  userId: string,
  myMembership?: ConversationMember,
): ConversationListItemDto {
  const activeMembers =
    conversation.members?.filter((m) => m.leftAt === null) ?? [];

  let name = conversation.name;
  let avatarUrl = conversation.avatarUrl;

  if (conversation.type === ConversationType.DIRECT) {
    const otherMember = activeMembers.find((m) => m.userId !== userId);
    if (otherMember?.user) {
      name = otherMember.user.fullName;
      avatarUrl = otherMember.user.avatarUrl;
    }
  }

  return {
    id: conversation.id,
    type: conversation.type as 'direct' | 'group',
    name,
    avatarUrl,
    lastMessage: null, // TODO: Add last message from ScyllaDB
    unreadCount: 0, // TODO: Calculate from lastReadAt
    lastMessageAt: conversation.lastMessageAt,
    isMuted: myMembership?.isMuted ?? false,
    isPinned: myMembership?.isPinned ?? false,
    pinnedAt: myMembership?.pinnedAt ?? null,
    memberCount: activeMembers.length,
    createdAt: conversation.createdAt,
  };
}

export function toDetailResponse(
  conversation: Conversation,
  myMembership: ConversationMember,
): ConversationDetailDto {
  const activeMembers =
    conversation.members?.filter((m) => m.leftAt === null) ?? [];

  return {
    id: conversation.id,
    type: conversation.type as 'direct' | 'group',
    name: conversation.name,
    avatarUrl: conversation.avatarUrl,
    createdById: conversation.createdById,
    members: activeMembers.map((m) => toMemberResponse(m)),
    mySettings: {
      role: myMembership.role,
      nickname: myMembership.nickname,
      isMuted: myMembership.isMuted,
      isPinned: myMembership.isPinned,
      pinnedAt: myMembership.pinnedAt,
      lastReadAt: myMembership.lastReadAt,
    },
    settings:
      conversation.type === ConversationType.GROUP
        ? normalizeGroupSettings(conversation.settings)
        : null,
    createdAt: conversation.createdAt,
  };
}

export function toMemberResponse(
  member: ConversationMember,
): ConversationMemberResponseDto {
  return {
    id: member.id,
    userId: member.userId,
    fullName: member.user?.fullName ?? 'Unknown',
    avatarUrl: member.user?.avatarUrl ?? null,
    role: member.role,
    nickname: member.nickname,
    joinedAt: member.joinedAt,
  };
}

export function resolveLastMessageType(
  snapshot: LastMessage,
):
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'mixed'
  | 'deleted'
  | 'unknown' {
  if (snapshot.message_type) {
    return snapshot.message_type;
  }

  if (snapshot.has_attachments) {
    return 'unknown';
  }

  return snapshot.body.trim().length > 0 ? 'text' : 'unknown';
}

export function toGroupInviteItem(
  invite: ConversationInvite,
): GroupInviteItemDto {
  const status =
    invite.status === GroupInviteStatus.PENDING &&
    invite.expiresAt.getTime() <= Date.now()
      ? GroupInviteStatus.EXPIRED
      : invite.status;

  return {
    id: invite.id,
    conversationId: invite.conversationId,
    inviterUserId: invite.inviterUserId,
    invitedUserId: invite.invitedUserId,
    status,
    message: invite.message,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    respondedAt: invite.respondedAt,
  };
}
