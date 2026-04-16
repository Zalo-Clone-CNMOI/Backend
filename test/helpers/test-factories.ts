/**
 * Test factories for creating mock entities and payloads.
 * Used across all test suites to avoid duplication.
 */
import { v4 as uuidv4 } from 'uuid';

// ─── User Factory ────────────────────────────────────────────────────────────

export interface MockUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  status: string;
  passwordHash: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: uuidv4(),
    phone: `+8490${Math.floor(1000000 + Math.random() * 9000000)}`,
    email: null,
    fullName: 'Test User',
    avatarUrl: null,
    bio: null,
    gender: null,
    dateOfBirth: null,
    status: 'active',
    passwordHash: '$2b$12$LJ3m4ys3LzQrKBNsGhB6Z.abc123hashplaceholder',
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── JWT Payload Factory ─────────────────────────────────────────────────────

export function createMockJwtPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: uuidv4(),
    phone: '+84901234567',
    type: 'access' as const,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

// ─── Chat Message Payload Factory ────────────────────────────────────────────

export function createMockChatSendCommand(
  overrides: Record<string, unknown> = {},
) {
  return {
    message_id: uuidv4(),
    conversation_id: uuidv4(),
    sender_id: uuidv4(),
    body: 'Hello, world!',
    sent_at: Date.now(),
    attachments: undefined,
    reply_to_message_id: undefined,
    trace_id: `ws:test-socket:${uuidv4()}`,
    ...overrides,
  };
}

// ─── Presence Payload Factories ──────────────────────────────────────────────

export function createMockPresenceConnect(
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id: uuidv4(),
    emitted_at: Date.now(),
    user_id: uuidv4(),
    socket_id: `socket-${uuidv4().slice(0, 8)}`,
    connected_at: Date.now(),
    trace_id: `test-trace-${uuidv4().slice(0, 8)}`,
    ...overrides,
  };
}

export function createMockPresenceDisconnect(
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id: uuidv4(),
    emitted_at: Date.now(),
    user_id: uuidv4(),
    socket_id: `socket-${uuidv4().slice(0, 8)}`,
    disconnected_at: Date.now(),
    trace_id: `test-trace-${uuidv4().slice(0, 8)}`,
    ...overrides,
  };
}

// ─── Conversation Member Factory ─────────────────────────────────────────────

export function createMockConversationMember(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: uuidv4(),
    conversationId: uuidv4(),
    userId: uuidv4(),
    role: 'member',
    nickname: null,
    isMuted: false,
    lastReadAt: null,
    joinedAt: new Date(),
    leftAt: null,
    ...overrides,
  };
}

// ─── QR Session Factory ─────────────────────────────────────────────────────

export function createMockQrSession(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    sessionId: uuidv4(),
    qrToken: `qr_${uuidv4()}_${now}`,
    status: 'PENDING',
    socketId: `socket-${uuidv4().slice(0, 8)}`,
    pcDeviceInfo: undefined,
    userId: undefined,
    createdAt: now,
    expiresAt: now + 300_000,
    ...overrides,
  };
}

// ─── Authenticated User Factory ──────────────────────────────────────────────

export function createMockAuthenticatedUser(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: uuidv4(),
    phone: '+84901234567',
    email: undefined,
    fullName: 'Test User',
    avatarUrl: undefined,
    status: 'active',
    ...overrides,
  };
}

// ─── Chat Forward Command Factory ────────────────────────────────────────────

export function createMockChatForwardCommand(
  overrides: Record<string, unknown> = {},
) {
  const sourceMessageId = uuidv4();
  const sourceConversationId = uuidv4();
  const sourceSenderId = uuidv4();
  return {
    message_id: uuidv4(),
    conversation_id: uuidv4(),
    sender_id: uuidv4(),
    sent_at: Date.now(),
    body: 'Hello from original sender',
    attachments: undefined,
    forwarded_from: {
      source_message_id: sourceMessageId,
      source_conversation_id: sourceConversationId,
      source_sender_id: sourceSenderId,
      source_sender_name_snapshot: 'Original Sender',
      source_created_at: Date.now() - 60_000,
      source_type: 'text',
    },
    forward_id: uuidv4(),
    trace_id: `bff:${uuidv4()}:${uuidv4()}`,
    ...overrides,
  };
}

// ─── Mock Socket Factory ─────────────────────────────────────────────────────

export function createMockSocket(overrides: Record<string, unknown> = {}) {
  const userId = (overrides.userId as string) ?? uuidv4();
  return {
    id: `socket-${uuidv4().slice(0, 8)}`,
    data: { userId },
    handshake: {
      headers: { authorization: `Bearer mock-token` },
      auth: { token: 'mock-token' },
    },
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  };
}
