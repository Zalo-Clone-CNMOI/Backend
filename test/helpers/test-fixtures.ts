/**
 * @file test-fixtures.ts
 *
 * Shared factories for integration test data.
 * Each factory returns a valid object with sensible defaults.
 * Override any field via the partial parameter.
 */
import { v4 as uuid } from 'uuid';

// ─── Chat ──────────────────────────────────────────────

export function makeChatMessageSendCommand(
  overrides: Record<string, unknown> = {},
) {
  return {
    message_id: uuid(),
    conversation_id: uuid(),
    sender_id: uuid(),
    body: 'Hello, world!',
    sent_at: Date.now(),
    attachments: undefined,
    reply_to_message_id: undefined,
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makeChatMessageEditCommand(
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return {
    message_id: uuid(),
    conversation_id: uuid(),
    sender_id: uuid(),
    created_at: now,
    new_body: 'Edited message',
    edited_at: now,
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makeChatMessageDeleteCommand(
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return {
    message_id: uuid(),
    conversation_id: uuid(),
    sender_id: uuid(),
    created_at: now,
    deleted_at: now,
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makeChatReactionAddCommand(
  overrides: Record<string, unknown> = {},
) {
  return {
    message_id: uuid(),
    conversation_id: uuid(),
    user_id: uuid(),
    reaction_type: 'like' as const,
    created_at: Date.now(),
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makeChatReactionRemoveCommand(
  overrides: Record<string, unknown> = {},
) {
  return {
    message_id: uuid(),
    conversation_id: uuid(),
    user_id: uuid(),
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

// ─── Presence ──────────────────────────────────────────

export function makePresenceConnectCommand(
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return {
    event_id: uuid(),
    user_id: uuid(),
    socket_id: `socket-${uuid()}`,
    connected_at: now,
    emitted_at: now,
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makePresenceDisconnectCommand(
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return {
    event_id: uuid(),
    user_id: uuid(),
    socket_id: `socket-${uuid()}`,
    disconnected_at: now,
    emitted_at: now,
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

export function makePresenceHeartbeatCommand(
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id: uuid(),
    user_id: uuid(),
    socket_id: `socket-${uuid()}`,
    ts: Date.now(),
    emitted_at: Date.now(),
    trace_id: `trace-${uuid()}`,
    ...overrides,
  };
}

// ─── User data ─────────────────────────────────────────

export function makeUserProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    fullName: 'Test User',
    phone: `+8490${Math.floor(Math.random() * 10000000)
      .toString()
      .padStart(7, '0')}`,
    email: null,
    avatarUrl: null,
    bio: null,
    gender: null,
    dateOfBirth: null,
    ...overrides,
  };
}

// ─── Conversation data ─────────────────────────────────

export function makeConversationData(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    type: 'group',
    name: 'Test Group',
    avatarUrl: null,
    createdById: uuid(),
    lastMessageId: null,
    lastMessageAt: null,
    ...overrides,
  };
}

export function makeConversationMemberData(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: uuid(),
    conversationId: uuid(),
    userId: uuid(),
    role: 'member',
    nickname: null,
    isMuted: false,
    lastReadAt: null,
    joinedAt: new Date(),
    leftAt: null,
    ...overrides,
  };
}

// ─── Friendship data ──────────────────────────────────

export function makeFriendshipData(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    requesterId: uuid(),
    addresseeId: uuid(),
    status: 'pending',
    ...overrides,
  };
}
