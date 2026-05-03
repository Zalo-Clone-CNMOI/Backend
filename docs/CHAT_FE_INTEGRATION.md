# Chat Integration Guide — Frontend Developer

This document covers everything a frontend developer needs to integrate with the real-time chat system built on `ws-gateway` (Socket.IO) and `chat-service` (REST read API).

---

## Architecture Overview

```
Frontend
  |-- HTTP REST  -->  BFF Service         (port 3000)
  |                     `-- proxies to --> chat-service (port 5002, internal)
  |
  `-- WebSocket  -->  WS Gateway          (port 3001)
                        `-- Kafka pub/sub <-> all backend services
```

| Service        | URL                      | Protocol  | Purpose                                   |
| -------------- | ------------------------ | --------- | ----------------------------------------- |
| `bff-service`  | `http://<host>:3000`     | HTTP REST | Auth, user, conversation management       |
| `chat-service` | `http://<host>:5002/api` | HTTP REST | Message history and reactions (read-only) |
| `ws-gateway`   | `ws://<host>:3001`       | Socket.IO | All real-time events                      |

> **Note:** In production, `chat-service` is an internal service — HTTP calls should go through the BFF or an API gateway, not directly from the browser.

---

## 1. Authentication

All WebSocket connections and chat API calls require a valid **JWT access token** obtained from the SSO service.

### Token Constraints

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| `type` claim   | Must be `'access'` (refresh tokens are rejected) |
| `sub` claim    | User UUID                                        |
| Default expiry | 15 minutes (access), 7 days (refresh)            |

### Connecting to WebSocket with Auth

**Option A — `auth` object (recommended for Socket.IO):**

```js
import { io } from 'socket.io-client';

const socket = io('http://<host>:3001', {
  auth: {
    token: `Bearer ${accessToken}`,
  },
  transports: ['websocket', 'polling'],
});
```

**Option B — HTTP header:**

```js
const socket = io('http://<host>:3001', {
  extraHeaders: {
    Authorization: `Bearer ${accessToken}`,
  },
  transports: ['websocket', 'polling'],
});
```

The `Bearer ` prefix is stripped automatically. If the token is invalid or missing, the socket can still connect, but guarded handlers reject and emit `ws:error`.

### Auth failure behavior on guarded WS events

When auth is missing/invalid for a guarded event, the gateway emits a standardized error envelope:

```ts
socket.on(
  'ws:error',
  (e: {
    code: 'UNAUTHORIZED' | string;
    message: string;
    details?: unknown;
    timestamp?: string;
  }) => {
    // Show toast, refresh token, or redirect login
  },
);
```

So FE should not rely only on `connect_error`; connection can still be established, but guarded handlers will reject and emit `ws:error`.

---

## 2. Presence — Connect / Disconnect / Heartbeat

> **This is fully automatic.** You do NOT emit connect or disconnect events manually. The server handles them via Socket.IO lifecycle hooks.

### How it works

```
FE connects     -->  handleConnection() in ChatGateway
                       --> emits Kafka: PresenceConnect
                       --> presence-service marks user ONLINE
                       --> broadcasts presence:update { status: 'online' } to all

FE disconnects  -->  handleDisconnect() in ChatGateway
                       --> emits Kafka: PresenceDisconnect
                       --> presence-service marks user OFFLINE (if no other sockets)
                       --> broadcasts presence:update { status: 'offline' } to all

FE sends heartbeat every 30s  -->  @SubscribeMessage('presence:heartbeat')
                                     --> emits Kafka: PresenceHeartbeat
                                     --> presence-service refreshes TTL for this socket
```

### What the FE must do

1. **Connect with a valid JWT** — presence is recorded automatically on connect.
2. **Send `presence:heartbeat` every 30 seconds** — keeps the session alive. Without heartbeats, the server's cleanup interval will eventually mark the socket as expired and fire an `offline` event.
3. **Nothing else** — disconnect is handled automatically when the socket closes.

### `presence:heartbeat` (Client → Server)

```ts
// Send every 30 seconds while the app is open
setInterval(() => {
  socket.emit('presence:heartbeat', { ts: Date.now() });
}, 30_000);
```

Payload:

```ts
{
  ts: number; // Client-side epoch milliseconds (Date.now())
}
```

No server response event for heartbeat.

### `presence:update` (Server → Client, broadcasted globally)

Fired whenever any user's online/offline status changes. Sent to **all** connected sockets.

```ts
socket.on(
  'presence:update',
  (p: {
    version: 'v1';
    user_id: string;
    status: 'online' | 'offline';
    last_seen_at: number; // epoch ms
    expires_at: number; // epoch ms — when the online TTL expires
    source:
      | 'connect'
      | 'disconnect'
      | 'heartbeat'
      | 'ttl_expire'
      | 'network_drop';
    offline_reason?:
      | 'logical_disconnect'
      | 'network_drop'
      | 'ttl_expire'
      | 'cleanup';
    socket_count: number; // number of active sockets — user is online if > 0
  }) => {
    updateOnlineBadge(p.user_id, p.status);
  },
);
```

> **Tip:** Use `socket_count > 0` (not just `status`) to determine if a user is genuinely online — a user can have multiple browser tabs open.

### Token expiry — reconnect with refreshed token

```ts
socket.on('connect_error', async (err) => {
  if (err.message.includes('unauthorized')) {
    const newToken = await refreshAccessToken();
    socket.auth = { token: `Bearer ${newToken}` };
    socket.connect();
  }
});
```

---

## 3. REST API — Message History

Base URL: `http://<host>:5002/api` (or proxied via BFF at `http://<host>:3000`)

### `GET /v1/messages/:conversationId`

Fetch messages using **cursor-based pagination** (newest-first).

**Path parameter:**

- `conversationId` — UUID

**Query parameters:**

| Param    | Type   | Default | Constraints      | Description                               |
| -------- | ------ | ------- | ---------------- | ----------------------------------------- |
| `limit`  | number | `50`    | 1–100            | Messages per page                         |
| `cursor` | string | —       | Base64 timestamp | Opaque — use value from previous response |

**Response `200`:**

```ts
{
  items: MessageDto[];
  nextCursor: string | null;  // Pass as ?cursor= for next page
  hasMore: boolean;
}
```

**Load first page:**

```ts
const res = await fetch(`/api/v1/messages/${convId}?limit=50`);
const { items, nextCursor, hasMore } = await res.json();
```

**Load next page (infinite scroll):**

```ts
if (hasMore) {
  const res = await fetch(
    `/api/v1/messages/${convId}?limit=50&cursor=${nextCursor}`,
  );
}
```

> **Caching:** First-page results (no cursor, limit <= 50) are Redis-cached per conversation. Cache is invalidated on any write (send / edit / delete).

---

### `GET /v1/messages/:conversationId/:createdAt/:messageId`

Fetch a single message by its composite key. Use this to load full attachment details after receiving a `chat:message` event.

**Path parameters:**

| Param            | Type               | Description        |
| ---------------- | ------------------ | ------------------ |
| `conversationId` | UUID               |                    |
| `createdAt`      | number (as string) | Epoch milliseconds |
| `messageId`      | UUID               |                    |

**Response `200`:** `MessageDto`

**Response `404`:**

```json
{ "message": "Message not found", "statusCode": 404 }
```

---

### `GET /v1/messages/:messageId/reactions`

Fetch all reactions for a message.

**Response `200`:**

```ts
{
  messageId: string;
  reactions: Array<{
    userId: string;
    reactionType: ReactionType;
    createdAt: number; // epoch ms
  }>;
  summary: Array<{
    type: ReactionType;
    count: number;
    userIds: string[];
  }>;
}
```

---

### Data Models

#### `MessageDto`

```ts
interface MessageDto {
  messageId: string; // UUID
  conversationId: string; // UUID
  senderId: string; // UUID
  body: string; // Empty string "" when isDeleted=true
  createdAt: number; // Epoch milliseconds
  attachments: AttachmentDto[]; // Empty array if no attachments
  replyToMessageId?: string; // UUID, present if this is a reply
  editedAt?: number; // Epoch ms, present if edited
  deletedAt?: number; // Epoch ms, present if deleted
  isDeleted: boolean;
}
```

#### `AttachmentDto`

```ts
interface AttachmentDto {
  key: string; // S3 object key
  type: 'image' | 'video' | 'audio' | 'document';
  name: string; // Original filename
  size: number; // Bytes
  contentType: string; // MIME type (e.g. "image/jpeg")
  thumbnailKey?: string; // S3 key for thumbnail (images)
  visibility: 'public' | 'private'; // File access mode
  url: string | null; // CDN URL for public files, null for private
  thumbnailUrl?: string; // CDN URL for thumbnail
}
```

> **Public files** (images, videos): `url` contains a CDN URL — display directly.
> **Private files** (documents, audio): `url` is `null` — call `POST /v1/media/presign/download` to get a temporary URL. See [MEDIA_UPLOAD_GUIDE.md](./MEDIA_UPLOAD_GUIDE.md) for details.

#### `ReactionType`

```ts
type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
```

---

## 4. WebSocket — Chat Events

### Room Topology

| Room                    | Who joins                                                    | Purpose                                               |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `conv:{conversationId}` | Sockets that emit `chat:join`                                | Chat message broadcasts                               |
| `user:{userId}`         | All authenticated sockets of a user (auto-joined on connect) | Targeted events (AI results, friend/QR notifications) |

> **Critical:** `conv:{}` rooms are NOT persisted across disconnections. You must re-emit `chat:join` on every connect/reconnect for each open conversation.

---

### Client → Server Events

Send with `socket.emit(event, payload)`.

---

#### `chat:join`

Join a conversation room to receive real-time messages for it.

```ts
socket.emit('chat:join', {
  conversation_id: string, // UUID
});
```

Response behavior:

- Rejected join emits `chat:ack` with `status: 'rejected'` and `reason: 'not_member'`.
- Successful join does not emit `chat:ack`; room join is silent.

---

#### `chat:send`

Send a new message.

```ts
socket.emit('chat:send', {
  message_id: string;            // Client-generated UUID (idempotency key)
  conversation_id: string;       // UUID
  body: string;                  // Message text (max 4000 chars)
  sent_at: number;               // Date.now()
  attachments?: Array<{
    key: string;                 // S3 key — upload first via media-service
    type: 'image' | 'video' | 'audio' | 'document';
    name: string;
    size: number;
    content_type: string;        // MIME type
    thumbnail_key?: string;
    visibility?: 'public' | 'private';  // From presign/upload response
  }>;
  reply_to_message_id?: string;  // UUID of message being replied to
  mentions?: Array<{             // @mention list (see §11)
    user_id: string;             // UUID of mentioned user, or '__ALL__' for @all
    mention_type: 'user' | 'all';
    offset: number;              // UTF-16 char offset in body (0-based)
    length: number;              // length of the @mention text in body (min 1)
  }>;
});
```

> **Important:** Generate `message_id` client-side using `crypto.randomUUID()`. This is the idempotency key — resending the same `message_id` will not create duplicates.

> **Attachments are validated** before acceptance. Each attachment key must exist in `media_files`, belong to the sender, and have `status=uploaded`. See rejection reasons below.

---

#### `chat:edit`

Edit the text body of a message (sender only).

```ts
socket.emit('chat:edit', {
  message_id: string;       // UUID of message to edit
  conversation_id: string;  // UUID
  new_body: string;
  created_at: number;       // Original message created_at (epoch ms)
});
```

---

#### `chat:delete`

Soft-delete a message — sets `isDeleted: true`, clears `body` to `""`.

```ts
socket.emit('chat:delete', {
  message_id: string;       // UUID
  conversation_id: string;  // UUID
  created_at: number;       // Original message created_at (epoch ms)
});
```

---

#### `chat:typing`

Broadcast current typing users in a conversation.

```ts
socket.emit('chat:typing', {
  conversation_id: string;
  username: string;
});
```

Server emits:

```ts
socket.on(
  'chat:typing:update',
  (p: {
    conversation_id: string;
    users: Array<{
      user_id: string;
      username: string;
    }>;
  }) => {
    renderTypingUsers(p.conversation_id, p.users);
  },
);
```

Notes:

- Gateway throttles typing events per user/conversation.
- Typing state auto-expires quickly.
- After `chat:send`, typing state of sender is cleared by server.

---

#### `chat:react`

Add an emoji reaction to a message.

```ts
socket.emit('chat:react', {
  message_id: string;
  conversation_id: string;
  reaction_type: ReactionType;
});
```

---

#### `chat:unreact`

Remove your reaction from a message.

```ts
socket.emit('chat:unreact', {
  message_id: string;
  conversation_id: string;
});
```

---

### Server → Client Chat Events

Listen with `socket.on(event, handler)`.

---

#### `chat:ack`

Immediate acknowledgment of your chat commands.

```ts
socket.on('chat:ack', ({ message_id, status, reason }) => {
  // status: 'accepted' | 'rejected'
  // reason?: see table below
});
```

| `reason`                             | Meaning                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `not_member`                         | User is not a member of the conversation                         |
| `attachment_not_found`               | Attachment key does not exist in media_files                     |
| `attachment_not_owned`               | Attachment was uploaded by a different user                      |
| `attachment_not_ready`               | Attachment upload not confirmed yet (status != uploaded)         |
| `mention_offset_out_of_bounds`       | A mention offset+length exceeds the body length                  |
| `mention_target_not_member`          | A mentioned user is not a member of the conversation             |
| `conversation_not_found`             | Conversation does not exist (@all validation failed)             |
| `at_all_in_direct_chat_disallowed`   | @all is only allowed in group conversations, not direct chats    |
| `at_all_rate_limited`                | @all used more than 3 times per minute — slow down               |

---

#### `chat:message`

A new message was created in a conversation.

```ts
socket.on(
  'chat:message',
  (msg: {
    message_id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    created_at: number; // epoch ms (server-assigned)
    attachments?: Array<{
      key: string;
      type: 'image' | 'video' | 'audio' | 'document';
      name: string;
      size: number;
      content_type: string;
      thumbnail_key?: string;
      visibility?: 'public' | 'private';
    }>;
    reply_to_message_id?: string;
    mentions?: Array<{            // present when message contains @mentions (see §11)
      user_id: string;            // UUID or '__ALL__'
      mention_type: 'user' | 'all';
      offset: number;
      length: number;
    }>;
  }) => {
    appendToUI(msg);
  },
);
```

> **Optimistic UI:** Match `msg.message_id` against your locally-pending message to replace the pending state.

> **Attachments** are included in the broadcast. For public files, build CDN URL from `key`. For private files, call `POST /v1/media/presign/download` to get a temporary download URL.

---

#### `chat:message:updated`

A message was edited.

```ts
socket.on(
  'chat:message:updated',
  (msg: {
    message_id: string;
    conversation_id: string;
    sender_id: string;
    body: string; // New body
    edited_at: number; // epoch ms
  }) => {},
);
```

---

#### `chat:message:deleted`

A message was soft-deleted.

```ts
socket.on(
  'chat:message:deleted',
  (msg: {
    message_id: string;
    conversation_id: string;
    sender_id: string;
    deleted_at: number;
  }) => {
    // Set item.isDeleted = true, item.body = '' in local state
  },
);
```

---

#### `chat:reaction:added`

```ts
socket.on(
  'chat:reaction:added',
  (r: {
    message_id: string;
    conversation_id: string;
    user_id: string;
    reaction_type: ReactionType;
    created_at: number;
  }) => {},
);
```

---

#### `chat:reaction:removed`

```ts
socket.on(
  'chat:reaction:removed',
  (r: { message_id: string; conversation_id: string; user_id: string }) => {},
);
```

---

## 5. WebSocket — AI Features

### Client → Server

```ts
// Get reply suggestions based on last message
socket.emit('ai:smart-reply:request', {
  conversation_id: string;
  last_message_id: string;
  last_message_body: string;
  context_count?: number;    // default: 10
});

// Get a summary of recent messages
socket.emit('ai:summary:request', {
  conversation_id: string;
  message_count?: number;    // default: 50
});

// Translate a message
socket.emit('ai:translate:request', {
  message_id: string;
  conversation_id: string;
  body: string;
  source_language?: string;  // ISO 639-1, e.g. "en" — auto-detect if omitted
  target_language: string;   // ISO 639-1, e.g. "vi"
});

// Query a document with natural language (RAG)
socket.emit('ai:document:query:request', {
  document_id: string;
  conversation_id: string;
  query: string;
  top_k?: number;
});
```

### Server → Client (sent to your personal room only)

```ts
socket.on(
  'ai:smart-reply:result',
  ({
    conversation_id,
    suggestions,
  }: {
    conversation_id: string;
    suggestions: string[];
  }) => {},
);

socket.on(
  'ai:summary:result',
  ({
    conversation_id,
    summary,
    message_range,
    cached,
  }: {
    conversation_id: string;
    summary: string;
    message_range: {
      from_message_id: string;
      to_message_id: string;
      count: number;
    };
    cached: boolean;
  }) => {},
);

socket.on(
  'ai:translate:result',
  ({
    message_id,
    conversation_id,
    original_body,
    translated_body,
    source_language,
    target_language,
    cached,
  }: {
    message_id: string;
    conversation_id: string;
    original_body: string;
    translated_body: string;
    source_language: string;
    target_language: string;
    cached: boolean;
  }) => {},
);

// Only emitted when content IS flagged (sender only)
socket.on(
  'ai:moderation:result',
  ({
    message_id,
    conversation_id,
    is_flagged,
    labels,
    confidence,
  }: {
    message_id: string;
    conversation_id: string;
    is_flagged: true;
    labels: Array<
      | 'spam'
      | 'toxic'
      | 'harassment'
      | 'hate_speech'
      | 'sexual'
      | 'violence'
      | 'self_harm'
    >;
    confidence: number; // 0.0–1.0
  }) => {},
);

socket.on(
  'ai:document:query:result',
  ({
    document_id,
    conversation_id,
    query,
    answer,
    sources,
  }: {
    document_id: string;
    conversation_id: string;
    query: string;
    answer: string;
    sources: Array<{
      chunk_index: number;
      content_preview: string;
      similarity_score: number;
    }>;
  }) => {},
);

// Streaming chunks (for streamed AI responses)
socket.on(
  'ai:stream:chunk',
  ({
    stream_id,
    conversation_id,
    feature,
    chunk_index,
    content,
    is_final,
  }: {
    stream_id: string;
    conversation_id: string;
    feature:
      | 'moderation'
      | 'smart_reply'
      | 'summary'
      | 'translation'
      | 'document_analysis';
    chunk_index: number;
    content: string;
    is_final: boolean;
  }) => {},
);

socket.on(
  'ai:stream:complete',
  ({
    stream_id,
    conversation_id,
    feature,
    total_chunks,
  }: {
    stream_id: string;
    conversation_id: string;
    feature: string;
    total_chunks: number;
  }) => {},
);
```

---

## 6. Social Notifications (Server → Client)

These events arrive on `user:{userId}` — your personal room, auto-joined on connect. No extra `join` needed.

```ts
// Someone sent you a friend request
socket.on('friend:request:send', ({ requestId, requester }) => {});

// Your friend request was accepted or rejected
socket.on(
  'friend:request:respond',
  ({
    requestId,
    status, // 'accepted' | 'rejected'
    addressee,
  }) => {},
);

// A pending request to you was cancelled
socket.on('friend:request:cancel', ({ requestId, requesterId }) => {});

// A user removed you from their friends list
socket.on('friend:removed', ({ userId }) => {});
```

---

## 7. QR Login Events (Server → Client)

Only relevant when implementing QR-code login (scan on mobile to log in on desktop).

### Desktop bind flow (Client → Server)

Desktop web/app should request a bind token first:

```ts
socket.emit('qr:bind:request');

socket.on(
  'qr:bind:issued',
  ({
    socketId,
    socketBindingToken,
    expiresInSeconds,
  }: {
    socketId: string;
    socketBindingToken: string;
    expiresInSeconds: number;
  }) => {
    // Encode token into QR for mobile scanner
  },
);
```

Rate limit:

- Max ~5 bind requests per minute per socket.
- When exceeded, gateway emits WS exception with code `RATE_LIMIT_EXCEEDED`.

```ts
socket.on(
  'qr:confirmed',
  ({ sessionId, accessToken, refreshToken, expiresIn, user }) => {
    // Store tokens and redirect to app
  },
);

socket.on('qr:rejected', ({ sessionId, reason }) => {});
```

---

## 8. Full Integration Example

```ts
import { io, Socket } from 'socket.io-client';

class ChatClient {
  private socket: Socket;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect(accessToken: string, initialConversationId?: string) {
    this.socket = io('http://<host>:3001', {
      auth: { token: `Bearer ${accessToken}` },
      transports: ['websocket', 'polling'],
    });

    // --- Lifecycle ---
    this.socket.on('connect', () => {
      console.log('Connected:', this.socket.id);
      // Presence:connect is handled automatically by the server.
      // Re-join conversation rooms after every connect/reconnect.
      if (initialConversationId) this.joinConversation(initialConversationId);
      // Start heartbeat to keep presence alive
      this.startHeartbeat();
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('Disconnected:', reason);
      // Presence:disconnect is handled automatically by the server.
      this.stopHeartbeat();
      // Socket.IO will auto-reconnect; rooms will be re-joined in 'connect' handler.
    });

    this.socket.on('connect_error', async (err) => {
      if (err.message.includes('unauthorized')) {
        const newToken = await refreshAccessToken();
        this.socket.auth = { token: `Bearer ${newToken}` };
        this.socket.connect();
      }
    });

    this.socket.on('ws:error', async (e) => {
      if (e.code === 'UNAUTHORIZED') {
        const newToken = await refreshAccessToken();
        this.socket.auth = { token: `Bearer ${newToken}` };
        this.socket.connect();
      }
    });

    // --- Chat events ---
    this.socket.on('chat:message', this.handleNewMessage);
    this.socket.on('chat:message:updated', this.handleMessageUpdated);
    this.socket.on('chat:message:deleted', this.handleMessageDeleted);
    this.socket.on('chat:reaction:added', this.handleReactionAdded);
    this.socket.on('chat:reaction:removed', this.handleReactionRemoved);
    this.socket.on('chat:typing:update', this.handleTypingUpdate);

    // --- Presence ---
    this.socket.on('presence:update', this.handlePresenceUpdate);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.socket.emit('presence:heartbeat', { ts: Date.now() });
    }, 30_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  joinConversation(conversationId: string) {
    this.socket.emit('chat:join', { conversation_id: conversationId });
  }

  sendMessage(conversationId: string, body: string) {
    const messageId = crypto.randomUUID();
    this.socket.emit('chat:send', {
      message_id: messageId,
      conversation_id: conversationId,
      body,
      sent_at: Date.now(),
    });
    // Listen once for ack
    this.socket.once('chat:ack', ({ message_id, status, reason }) => {
      if (message_id === messageId && status === 'rejected') {
        console.error('Message rejected:', reason);
      }
    });
    return messageId; // Use for optimistic UI matching
  }

  editMessage(
    conversationId: string,
    messageId: string,
    newBody: string,
    createdAt: number,
  ) {
    this.socket.emit('chat:edit', {
      message_id: messageId,
      conversation_id: conversationId,
      new_body: newBody,
      created_at: createdAt,
    });
  }

  deleteMessage(conversationId: string, messageId: string, createdAt: number) {
    this.socket.emit('chat:delete', {
      message_id: messageId,
      conversation_id: conversationId,
      created_at: createdAt,
    });
  }

  sendTyping(conversationId: string, username: string) {
    this.socket.emit('chat:typing', {
      conversation_id: conversationId,
      username,
    });
  }

  react(conversationId: string, messageId: string, type: string) {
    this.socket.emit('chat:react', {
      message_id: messageId,
      conversation_id: conversationId,
      reaction_type: type,
    });
  }

  unreact(conversationId: string, messageId: string) {
    this.socket.emit('chat:unreact', {
      message_id: messageId,
      conversation_id: conversationId,
    });
  }

  disconnect() {
    this.stopHeartbeat();
    this.socket?.disconnect();
    // Presence:disconnect fired automatically by server on socket close.
  }

  private handleNewMessage = (msg: any) => {
    /* append to UI */
  };
  private handleMessageUpdated = (msg: any) => {
    /* update in UI */
  };
  private handleMessageDeleted = (msg: any) => {
    /* mark as deleted */
  };
  private handleReactionAdded = (r: any) => {
    /* add reaction badge */
  };
  private handleReactionRemoved = (r: any) => {
    /* remove reaction badge */
  };
  private handleTypingUpdate = (p: any) => {
    /* update typing indicator */
  };
  private handlePresenceUpdate = (p: any) => {
    /* update online indicator */
  };
}
```

---

## 9. Loading History + Real-Time Sync

```ts
// 1. Load initial page from REST (Redis-cached, fast)
const { items, nextCursor, hasMore } = await fetchMessages(convId, {
  limit: 50,
});
renderMessages(items);

// 2. Join the WebSocket room for live updates
socket.emit('chat:join', { conversation_id: convId });

// 3. On scroll-up, load more pages
async function loadMore() {
  if (!hasMore || !nextCursor) return;
  const page = await fetchMessages(convId, { limit: 50, cursor: nextCursor });
  prependMessages(page.items);
  nextCursor = page.nextCursor;
  hasMore = page.hasMore;
}

// 4. Append live messages from WebSocket
socket.on('chat:message', (msg) => appendMessage(msg));
```

---

## 10. Attachment Upload Flow

Attachments must be uploaded to `media-service` **before** sending the message via WebSocket.

```
1. POST /v1/media/presign/upload  { contentType, fileName }
   → { key, uploadUrl, visibility }

2. PUT uploadUrl  (upload file binary directly to S3)
   → 200 OK

3. POST /v1/media/upload/confirm  { key, contentType, conversationId? }
   → { ok: true, thumbnailKey? }

4. socket.emit('chat:send', {
     ...,
     attachments: [{ key, type, name, size, content_type, thumbnail_key, visibility }]
   })

5. 'chat:message' broadcast includes attachments.
   For public files: build CDN URL from key.
   For private files: POST /v1/media/presign/download to get temp URL.
```

> For the full upload guide with code examples, see [MEDIA_UPLOAD_GUIDE.md](./MEDIA_UPLOAD_GUIDE.md).

---

## 11. @Mentions Feature

### 11.1 Overview

The mention feature lets users tag specific members (`@user`) or all members (`@all`) in a group conversation. Backend validates every mention before accepting the message and returns structured mention data in the `chat:message` broadcast. Mentioned users receive a **high-priority push notification** with `type: 'mention'` instead of the default `'chat_message'`.

| Mention type | Sentinel value    | Allowed in         | Rate limit |
| ------------ | ----------------- | ------------------ | ---------- |
| `user`       | target's UUID     | direct + group     | none       |
| `all`        | `'__ALL__'`       | group only         | 3 per 60 s |

---

### 11.2 Constraints (enforce client-side before sending)

| Constraint                 | Value                     |
| -------------------------- | ------------------------- |
| Max mentions per message   | 50                        |
| Max `offset`               | 4000 (= max body length)  |
| Min `length`               | 1                         |
| Max `length`               | 100                       |
| `offset + length`          | must be ≤ `body.length`   |
| Self-mention               | silently stripped by server |
| Duplicate `user_id`        | silently deduped by server |

> Client-side enforcement prevents unnecessary round-trips. These are also enforced server-side and will cause a `chat:ack { status: 'rejected' }`.

---

### 11.3 Sending a message with mentions

#### Payload

```ts
socket.emit('chat:send', {
  message_id: crypto.randomUUID(),
  conversation_id: '<uuid>',
  body: 'Hello @Alice and @all, check this out!',
  sent_at: Date.now(),
  mentions: [
    {
      user_id: 'alice-uuid-here',   // Alice's user ID
      mention_type: 'user',
      offset: 6,                    // index of '@' in body (UTF-16)
      length: 6,                    // length of '@Alice'
    },
    {
      user_id: '__ALL__',           // sentinel for @all
      mention_type: 'all',
      offset: 17,                   // index of '@' for '@all'
      length: 4,                    // length of '@all'
    },
  ],
});
```

> `offset` and `length` are **UTF-16 code unit** positions — the same as JavaScript's `String.prototype.slice()`. Emoji and CJK characters that are single UTF-16 code units count as 1. Surrogate pairs (emoji outside BMP) count as 2.

#### Computing offsets

```ts
// Example: body = 'Hello @Alice!'
// '@Alice' starts at index 6, length 6
const body = 'Hello @Alice!';
const mentionText = '@Alice';
const offset = body.indexOf(mentionText); // 6
const length = mentionText.length;        // 6
```

For multiple mentions, scan `body` for each `@<name>` occurrence in order:

```ts
function buildMentions(
  body: string,
  resolved: Array<{ displayName: string; userId: string }>,
): Array<{ user_id: string; mention_type: 'user' | 'all'; offset: number; length: number }> {
  const mentions: Array<{ user_id: string; mention_type: 'user' | 'all'; offset: number; length: number }> = [];
  let searchFrom = 0;

  for (const { displayName, userId } of resolved) {
    const tag = `@${displayName}`;
    const isAll = displayName.toLowerCase() === 'all';
    const idx = body.indexOf(tag, searchFrom);
    if (idx === -1) continue;
    mentions.push({
      user_id: isAll ? '__ALL__' : userId,
      mention_type: isAll ? 'all' : 'user',
      offset: idx,
      length: tag.length,
    });
    searchFrom = idx + tag.length;
  }

  return mentions;
}
```

---

### 11.4 Receiving messages with mentions (`chat:message`)

```ts
socket.on('chat:message', (msg) => {
  const myUserId = getCurrentUserId();

  const isMentioned = msg.mentions?.some(
    (m) => m.user_id === myUserId || m.mention_type === 'all',
  ) ?? false;

  renderMessage(msg, { highlight: isMentioned });
});
```

The `mentions` array is present only when the message actually has mentions. If the sender sent no mentions (or all were stripped), the field is absent.

**Highlight logic:**

```ts
function getMentionHighlight(
  body: string,
  mentions: Array<{ offset: number; length: number; mention_type: string; user_id: string }>,
  myUserId: string,
): Array<{ start: number; end: number; type: 'self' | 'all' | 'other' }> {
  return mentions.map((m) => ({
    start: m.offset,
    end: m.offset + m.length,
    type:
      m.user_id === myUserId ? 'self'
      : m.mention_type === 'all' ? 'all'
      : 'other',
  }));
}
```

Use `start`/`end` to wrap the corresponding substring in a styled `<span>`.

---

### 11.5 @mention suggestion UI

#### Step 1 — Detect trigger character

```ts
function detectMentionTrigger(
  value: string,
  caretPos: number,
): { query: string; triggerStart: number } | null {
  // Walk backwards from caret to find '@' not preceded by a word char
  for (let i = caretPos - 1; i >= 0; i--) {
    if (value[i] === '@') {
      const before = value[i - 1];
      if (i === 0 || /\s/.test(before)) {
        return { query: value.slice(i + 1, caretPos), triggerStart: i };
      }
      return null; // '@' embedded inside a word — not a trigger
    }
    if (/\s/.test(value[i])) return null; // space before finding '@'
  }
  return null;
}
```

#### Step 2 — Fetch suggestions

Suggestions come from the conversation's member list. Fetch it once when the conversation is opened:

```ts
// REST: GET /v1/conversations/:conversationId (BFF)
// Returns members with { user_id, full_name, avatar_url }
const members = await fetchConversationMembers(conversationId);
```

Filter locally on each keystroke:

```ts
function filterSuggestions(
  query: string,
  members: Member[],
  isGroup: boolean,
): SuggestionItem[] {
  const results: SuggestionItem[] = [];

  if (isGroup && 'all'.startsWith(query.toLowerCase())) {
    results.push({ type: 'all', label: '@all', userId: '__ALL__' });
  }

  const q = query.toLowerCase();
  for (const m of members) {
    if (m.full_name.toLowerCase().includes(q)) {
      results.push({ type: 'user', label: `@${m.full_name}`, userId: m.user_id });
    }
  }

  return results.slice(0, 10); // cap at 10 visible items
}
```

> **Do not** show `@all` for direct (1-on-1) conversations. The backend will reject it.

#### Step 3 — Confirm selection

When the user selects a suggestion:

```ts
function applyMention(
  inputValue: string,
  triggerStart: number,
  caretPos: number,
  selected: SuggestionItem,
): { newValue: string; newCaret: number } {
  const before = inputValue.slice(0, triggerStart);
  const after = inputValue.slice(caretPos);
  const inserted = `${selected.label} `; // trailing space
  return {
    newValue: before + inserted + after,
    newCaret: before.length + inserted.length,
  };
}
```

Track all confirmed selections in an array; build the `mentions` list from them on send (§11.3).

---

### 11.6 @all rate limit — client UX

Backend allows **3 @all mentions per 60 seconds** per sender per conversation. The client receives:

```ts
socket.on('chat:ack', ({ message_id, status, reason }) => {
  if (status === 'rejected' && reason === 'at_all_rate_limited') {
    showToast('Bạn đang dùng @all quá nhanh. Thử lại sau 1 phút.');
  }
});
```

Recommended: track client-side timestamps of `@all` sends and disable the `@all` suggestion item when 3+ have been sent in the last 60 s.

---

### 11.7 Unread mention badge

Backend increments a per-user per-conversation counter in ScyllaDB every time a user is mentioned. FE receives the counter value as part of the conversation list API response (field: `unread_mention_count`). Use it to render a `@` badge on the conversation entry:

```ts
// REST GET /v1/conversations  →  each item includes:
// { conversation_id, unread_count, unread_mention_count, ... }

function renderConversationItem(conv) {
  return (
    <ConvItem>
      {conv.unread_count > 0 && <Badge>{conv.unread_count}</Badge>}
      {conv.unread_mention_count > 0 && <MentionBadge>@</MentionBadge>}
    </ConvItem>
  );
}
```

The counter resets to 0 when the user **opens the conversation** (backend resets on read-receipt). No extra call needed from FE; it resets automatically on the read-receipt flow.

---

### 11.8 Push notification behavior

Mentioned users receive a push notification (via FCM/APNs) with these fields:

```json
{
  "title": "<SenderName> đã nhắc bạn",
  "body": "<first 100 chars of message>",
  "data": {
    "type": "mention",
    "conversation_id": "<uuid>",
    "message_id": "<uuid>",
    "sender_id": "<uuid>",
    "is_mention": "true"
  },
  "priority": "high"
}
```

Non-mentioned recipients receive:

```json
{
  "title": "<SenderName>",
  "body": "<first 100 chars of message>",
  "data": {
    "type": "chat_message",
    "conversation_id": "<uuid>",
    "message_id": "<uuid>"
  },
  "priority": "normal"
}
```

Use `data.type === 'mention'` in the notification handler to deep-link directly to the mentioned message.

---

### 11.9 Full React example — send with mentions

```tsx
import { useState, useRef, useCallback } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useConversationMembers } from '@/hooks/useConversationMembers';

interface MentionEntry {
  userId: string;
  displayName: string;
  offset: number;
  length: number;
  isAll: boolean;
}

export function MessageInput({ conversationId, isGroup }: { conversationId: string; isGroup: boolean }) {
  const socket = useSocket();
  const members = useConversationMembers(conversationId);
  const [body, setBody] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const confirmedMentions = useRef<MentionEntry[]>([]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setBody(value);

    const trigger = detectMentionTrigger(value, caret);
    if (trigger) {
      setTriggerStart(trigger.triggerStart);
      setSuggestions(filterSuggestions(trigger.query, members, isGroup));
    } else {
      setTriggerStart(null);
      setSuggestions([]);
    }
  }, [members, isGroup]);

  const handleSelect = useCallback((selected: SuggestionItem) => {
    const caret = body.length; // simplified; use actual caret ref in production
    const { newValue, newCaret } = applyMention(body, triggerStart!, caret, selected);
    setBody(newValue);
    setSuggestions([]);
    confirmedMentions.current.push({
      userId: selected.userId,
      displayName: selected.label.slice(1), // strip '@'
      offset: triggerStart!,
      length: selected.label.length,
      isAll: selected.type === 'all',
    });
  }, [body, triggerStart]);

  const handleSend = useCallback(() => {
    if (!body.trim()) return;

    const mentions = confirmedMentions.current
      .filter((m) => body.includes(`@${m.displayName}`)) // remove stale (user deleted the text)
      .map((m) => ({
        user_id: m.isAll ? '__ALL__' : m.userId,
        mention_type: (m.isAll ? 'all' : 'user') as 'user' | 'all',
        offset: body.indexOf(`@${m.displayName}`, m.offset > body.length ? 0 : m.offset),
        length: m.displayName.length + 1, // +1 for '@'
      }))
      .filter((m) => m.offset !== -1 && m.offset + m.length <= body.length);

    socket.emit('chat:send', {
      message_id: crypto.randomUUID(),
      conversation_id: conversationId,
      body,
      sent_at: Date.now(),
      ...(mentions.length > 0 ? { mentions } : {}),
    });

    setBody('');
    confirmedMentions.current = [];
  }, [body, conversationId, socket]);

  return (
    <div>
      <textarea value={body} onChange={handleChange} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
      {suggestions.length > 0 && (
        <ul className="mention-suggestions">
          {suggestions.map((s) => (
            <li key={s.userId} onClick={() => handleSelect(s)}>{s.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

### 11.10 Checklist — what FE must implement

- [ ] Parse typed `@` trigger and show suggestion popup
- [ ] Filter members by name prefix; include `@all` for groups only
- [ ] On member select: insert `@name ` into body, record `{ userId, offset, length }`
- [ ] Recompute offsets at send time (user may have edited text after selecting)
- [ ] Validate: `offset + length ≤ body.length`, `length ≥ 1`; drop invalid mentions before sending
- [ ] Include `mentions` array in `chat:send` payload
- [ ] In `chat:message` handler: check `mentions` for current user or `mention_type === 'all'`
- [ ] Highlight mention spans in rendered messages using `offset`/`length`
- [ ] Show `@` badge on conversation list if `unread_mention_count > 0`
- [ ] Handle `chat:ack { reason: 'at_all_rate_limited' }` — show toast, client-side throttle
- [ ] Handle `chat:ack { reason: 'mention_target_not_member' }` — show error
- [ ] Handle push notification `data.type === 'mention'` — deep-link to message
