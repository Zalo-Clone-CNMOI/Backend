# Database Schema Documentation

Tài liệu chi tiết về database schema của ZaloClone.

## Tổng quan

ZaloClone sử dụng **multi-database architecture**:

| Database | Mục đích | Tables |
|----------|----------|--------|
| **PostgreSQL** | User data, conversations, social graph, media metadata, AI logs | 17 tables |
| **ScyllaDB** | Messages, reactions, read receipts, idempotency | 8 tables |
| **Redis** | Presence cache, typing indicators | Key-value |

> Tất cả PostgreSQL entities kế thừa `BaseEntity` từ `@libs/shared`, cung cấp `id uuid [pk]`, `created_at timestamp`, `updated_at timestamp`.

---

## PostgreSQL Tables

### Users Domain

#### Table users

```dbml
Table users {
  id uuid [pk, default: `gen_random_uuid()`]
  phone varchar(20) [not null, unique]
  email varchar(255) [unique, null]
  password_hash varchar(255) [not null]
  full_name varchar(255) [not null]
  avatar_url varchar(500) [null]
  bio varchar(500) [null]
  gender varchar(10) [null]
  date_of_birth date [null]
  status varchar(20) [not null, default: 'active']  // enum: active, inactive, banned
  last_seen_at timestamp [null]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  Note: 'Người dùng hệ thống. Là entity chính của ứng dụng.'
}
```

#### Table device_tokens

```dbml
Table device_tokens {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  token varchar(500) [not null]
  platform varchar(20) [not null]  // ios | android | web
  device_id varchar(255) [null]
  is_active boolean [default: true]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (user_id, token) [unique]
    token
  }

  Note: 'Device tokens cho FCM/APNs push notification.'
}
```

### Conversations Domain

#### Table conversations

```dbml
Table conversations {
  id uuid [pk]
  type varchar(20) [not null, default: 'direct']  // direct | group
  name varchar(255) [null]
  avatar_url varchar(500) [null]
  created_by uuid [null, ref: > users.id]
  last_message_id uuid [null]
  last_message_at timestamp [null]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    last_message_at [desc]
  }

  Note: 'Cuộc hội thoại. Type: direct (1-1) hoặc group (nhóm).'
}
```

#### Table conversation_members

```dbml
Table conversation_members {
  id uuid [pk]
  conversation_id uuid [not null, ref: > conversations.id]
  user_id uuid [not null, ref: > users.id]
  role varchar(20) [not null, default: 'member']  // owner | admin | member
  nickname varchar(100) [null]
  is_muted boolean [default: false]
  last_read_at timestamp [null]
  joined_at timestamp [default: `now()`]
  left_at timestamp [null]

  indexes {
    (conversation_id, user_id) [unique]
    conversation_id
    user_id
    left_at
  }

  Note: 'Thành viên conversation. Role: owner, admin, member.'
}
```

### Friends Domain

#### Table friendships

```dbml
Table friendships {
  id uuid [pk]
  requester_id uuid [not null, ref: > users.id]
  addressee_id uuid [not null, ref: > users.id]
  status varchar(20) [not null, default: 'pending']  // enum: pending, accepted, blocked
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (requester_id, addressee_id) [unique]
    status
  }

  Note: 'Quan hệ bạn bè và friend requests. Status: pending (chờ chấp nhận), accepted (đã kết bạn), blocked.'
}
```

### Media Domain

#### Table media_files

```dbml
Table media_files {
  id uuid [pk]
  key varchar(500) [not null, unique]           // S3 object key (e.g. public/uuid.jpg)
  bucket varchar(100) [not null]
  content_type varchar(100) [not null]
  size_bytes bigint [null]
  uploaded_by uuid [null, ref: > users.id]
  conversation_id uuid [null, ref: > conversations.id]
  status varchar(20) [not null, default: 'pending']  // pending | uploaded | deleted
  visibility varchar(10) [not null, default: 'public']  // public | private
  thumbnail_key varchar(500) [null]             // S3 key của thumbnail (ảnh/video)
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    uploaded_by
    (conversation_id, created_at) [desc]
  }

  Note: 'Metadata của files trên S3. Mỗi forward tạo bản copy độc lập.'
}
```

### Nhật Ký Domain (Timeline)

#### Table posts

```dbml
Table posts {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  content text [null]
  visibility varchar(20) [not null, default: 'friends']  // public | friends | only_me
  like_count int [default: 0]
  comment_count int [default: 0]
  share_count int [default: 0]
  is_pinned boolean [default: false]
  is_deleted boolean [default: false]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  Note: 'Bài đăng Nhật Ký.'
}
```

#### Table post_media

```dbml
Table post_media {
  id uuid [pk]
  post_id uuid [not null, ref: > posts.id]
  media_url varchar(500) [not null]
  media_type varchar(20) [not null]  // image | video
  thumbnail_url varchar(500) [null]
  width int [null]
  height int [null]
  duration_seconds int [null]
  display_order int [default: 0]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (post_id, display_order)
  }

  Note: 'Media đính kèm bài đăng.'
}
```

#### Table post_likes

```dbml
Table post_likes {
  id uuid [pk]
  post_id uuid [not null, ref: > posts.id]
  user_id uuid [not null, ref: > users.id]
  reaction_type varchar(20) [not null, default: 'like']  // like | love | haha | wow | sad | angry
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (post_id, user_id) [unique]
    post_id
    (user_id, created_at) [desc]
  }

  Note: 'Lượt like/reaction bài đăng.'
}
```

#### Table post_comments

```dbml
Table post_comments {
  id uuid [pk]
  post_id uuid [not null, ref: > posts.id]
  user_id uuid [not null, ref: > users.id]
  parent_comment_id uuid [null, ref: > post_comments.id]
  content text [not null]
  like_count int [default: 0]
  is_deleted boolean [default: false]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (post_id, created_at)
    parent_comment_id
    user_id
  }

  Note: 'Bình luận bài đăng. Hỗ trợ nested replies.'
}
```

#### Table comment_likes

```dbml
Table comment_likes {
  id uuid [pk]
  comment_id uuid [not null, ref: > post_comments.id]
  user_id uuid [not null, ref: > users.id]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (comment_id, user_id) [unique]
    comment_id
  }

  Note: 'Lượt like bình luận.'
}
```

### Notification Domain

#### Table notification_preferences

```dbml
Table notification_preferences {
  id uuid [pk]
  user_id uuid [not null, unique, ref: > users.id]
  push_enabled boolean [default: true]
  sound_enabled boolean [default: true]
  vibrate_enabled boolean [default: true]
  show_preview boolean [default: true]
  quiet_hours_start time [null]
  quiet_hours_end time [null]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  Note: 'Cài đặt notification của user (1-1 với users).'
}
```

#### Table notification_logs

```dbml
Table notification_logs {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  channel varchar(20) [not null]   // push | email | sms
  provider varchar(50) [not null]  // fcm | apns | mock
  title varchar(255) [null]
  body text [null]
  data jsonb [null]
  status varchar(20) [not null]    // sent | failed | pending
  error_message text [null]
  sent_at timestamp [default: `now()`]

  indexes {
    (user_id, sent_at) [desc]
  }

  Note: 'Lịch sử notification đã gửi.'
}
```

### AI Domain

#### Table ai_moderation_logs

```dbml
Table ai_moderation_logs {
  id uuid [pk]
  message_id uuid [not null]       // ScyllaDB message ID (không có FK)
  conversation_id uuid [not null]
  sender_id uuid [not null, ref: > users.id]
  is_flagged boolean [not null, default: false]
  labels text[] [null]             // e.g. ['hate_speech', 'spam']
  confidence float [not null, default: 0]
  provider varchar(20) [not null]
  ensemble boolean [not null, default: false]
  tokens_used int [not null, default: 0]
  trace_id varchar(64) [null]
  processed_at timestamp [default: `now()`]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    message_id
    (conversation_id, processed_at) [desc]
    (is_flagged, processed_at) [desc]
  }

  Note: 'Log kiểm duyệt AI cho từng message. Dùng để audit và điều chỉnh ngưỡng.'
}
```

#### Table ai_usage_logs

```dbml
Table ai_usage_logs {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  feature varchar(30) [not null]   // smart_reply | summary | translate | moderation | document_query
  provider varchar(20) [not null]
  model varchar(50) [null]
  tokens_in int [not null, default: 0]
  tokens_out int [not null, default: 0]
  total_tokens int [not null, default: 0]
  estimated_cost_usd decimal(10,6) [not null, default: 0]
  latency_ms int [not null, default: 0]
  success boolean [not null, default: true]
  error_message text [null]
  trace_id varchar(64) [null]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    (user_id, created_at) [desc]
    (feature, created_at) [desc]
  }

  Note: 'Theo dõi usage và chi phí AI theo từng user và feature.'
}
```

### Document AI Domain

#### Table document_metadata

```dbml
Table document_metadata {
  id uuid [pk]
  conversation_id uuid [not null]
  user_id uuid [not null, ref: > users.id]
  file_key varchar(512) [not null]     // S3 key của file gốc
  file_name varchar(255) [not null]
  file_size int [not null]
  content_type varchar(100) [not null]
  status varchar(20) [not null, default: 'pending']  // pending | processing | ready | failed
  chunk_count int [not null, default: 0]
  total_tokens int [not null, default: 0]
  page_count int [null]
  error_message text [null]
  embedding_model varchar(50) [null]
  embedding_version int [not null, default: 1]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    conversation_id
    user_id
  }

  Note: 'Metadata của document đã upload để AI query. Mỗi file được chia thành chunks.'
}
```

#### Table document_chunks

```dbml
Table document_chunks {
  id uuid [pk]
  document_id uuid [not null, ref: > document_metadata.id]
  chunk_index int [not null]
  content text [not null]
  token_count int [not null, default: 0]
  embedding text [null]            // JSON string '[0.1,0.2,...]'; actual DB type: vector(1536) via pgvector
  embedding_model varchar(50) [null]
  embedding_version int [not null, default: 1]
  page_number int [null]
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]

  indexes {
    document_id
    // IVFFlat index on embedding column — managed via migration, not TypeORM sync
  }

  Note: 'Text chunks với vector embeddings cho semantic search. Requires pgvector extension.'
}
```

---

## ScyllaDB Tables

**Keyspace**: `chat`  
Schema file: `infra/scylla/schema.cql`

### Messages Domain

#### Table messages_by_conversation

```cql
CREATE TABLE messages_by_conversation (
    conversation_id text,
    created_at      bigint,
    message_id      text,
    sender_id       text,
    body            text,
    attachments     text,             -- JSON: MessageAttachment[] (null nếu không có file)
    reply_to_message_id text,         -- message_id được reply (null nếu không reply)
    forwarded_from  text,             -- JSON: ForwardedFrom (null với tin nhắn thường)
    edited_at       bigint,           -- epoch ms, null nếu chưa chỉnh sửa
    deleted_at      bigint,           -- epoch ms, null nếu chưa xóa (soft delete)
    PRIMARY KEY ((conversation_id), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at ASC, message_id ASC)
  AND default_time_to_live = 0
  AND gc_grace_seconds = 864000;
```

**forwarded_from JSON shape:**
```json
{
  "source_message_id": "uuid",
  "source_conversation_id": "uuid",
  "source_sender_id": "uuid",
  "source_sender_name_snapshot": "Nguyễn Văn A",
  "source_created_at": 1700000000000,
  "source_type": "text | image | file | mixed"
}
```

#### Table messages_by_id

```cql
CREATE TABLE messages_by_id (
    message_id      text PRIMARY KEY,
    conversation_id text,
    created_at      bigint
) WITH default_time_to_live = 0;
```

**Note:** Reverse-lookup index. Cho phép resolve `(conversation_id, created_at)` từ `message_id` trong O(1) — dùng bởi forward flow khi BFF cần lookup source message mà không biết conversation.

### Idempotency Domain

#### Table idempotency_by_message_id

```cql
CREATE TABLE idempotency_by_message_id (
    message_id      text PRIMARY KEY,
    conversation_id text,
    created_at      bigint,
    status          text              -- pending | stored
) WITH default_time_to_live = 604800; -- TTL 7 ngày
```

**Note:** Ngăn duplicate message khi client retry. Dùng lightweight transactions (`IF NOT EXISTS`, `IF status = ?`). TTL 7 ngày tự động dọn dẹp.

### Reactions Domain

#### Table message_reactions

```cql
CREATE TABLE message_reactions (
    message_id    text,
    user_id       text,
    reaction_type text,               -- like | love | haha | wow | sad | angry
    created_at    bigint,
    PRIMARY KEY (message_id, user_id, reaction_type)
);
```

#### Table message_reaction_counts

```cql
CREATE TABLE message_reaction_counts (
    message_id    text,
    reaction_type text,
    count         counter,
    PRIMARY KEY (message_id, reaction_type)
);
```

**Note:** Counter table — dùng `UPDATE ... SET count = count + 1` (không dùng INSERT). Đảm bảo atomic increment/decrement, tránh race condition.

### Read Receipts Domain

#### Table message_read_receipts

```cql
CREATE TABLE message_read_receipts (
    conversation_id text,
    message_id      text,
    user_id         text,
    read_at         bigint,
    PRIMARY KEY ((conversation_id, message_id), user_id)
);
```

#### Table last_read_by_user

```cql
CREATE TABLE last_read_by_user (
    user_id                text,
    conversation_id        text,
    last_read_message_id   text,
    last_read_at           bigint,
    PRIMARY KEY ((user_id), conversation_id)
);
```

**Note:** Message cuối cùng user đã đọc, dùng để tính unread count per conversation.

### Timeline Domain

#### Table timeline_feed_by_user

```cql
CREATE TABLE timeline_feed_by_user (
    user_id    text,
    created_at bigint,
    post_id    text,
    author_id  text,
    PRIMARY KEY ((user_id), created_at, post_id)
) WITH CLUSTERING ORDER BY (created_at DESC, post_id DESC)
  AND default_time_to_live = 2592000; -- TTL 30 ngày
```

**Note:** Fan-out on write pattern — TTL 30 ngày tự dọn dẹp.

---

## Relations

### Users Relations

```dbml
Ref: device_tokens.user_id > users.id [delete: cascade]
Ref: conversation_members.user_id > users.id [delete: cascade]
Ref: friendships.requester_id > users.id [delete: cascade]
Ref: friendships.addressee_id > users.id [delete: cascade]
Ref: media_files.uploaded_by > users.id [delete: set null]
Ref: posts.user_id > users.id [delete: cascade]
Ref: post_likes.user_id > users.id [delete: cascade]
Ref: post_comments.user_id > users.id [delete: cascade]
Ref: comment_likes.user_id > users.id [delete: cascade]
Ref: notification_preferences.user_id > users.id [delete: cascade]
Ref: notification_logs.user_id > users.id [delete: cascade]
Ref: ai_moderation_logs.sender_id > users.id [delete: cascade]
Ref: ai_usage_logs.user_id > users.id [delete: cascade]
Ref: document_metadata.user_id > users.id [delete: cascade]
```

### Conversations Relations

```dbml
Ref: conversations.created_by > users.id [delete: set null]
Ref: conversation_members.conversation_id > conversations.id [delete: cascade]
Ref: media_files.conversation_id > conversations.id [delete: set null]
```

### Posts Relations

```dbml
Ref: post_media.post_id > posts.id [delete: cascade]
Ref: post_likes.post_id > posts.id [delete: cascade]
Ref: post_comments.post_id > posts.id [delete: cascade]
```

### Comments Relations

```dbml
Ref: post_comments.parent_comment_id > post_comments.id [delete: cascade]
Ref: comment_likes.comment_id > post_comments.id [delete: cascade]
```

### Document Relations

```dbml
Ref: document_chunks.document_id > document_metadata.id [delete: cascade]
```

---

## Indexes

### PostgreSQL Indexes

```sql
-- Users
CREATE UNIQUE INDEX ON users(phone);
CREATE UNIQUE INDEX ON users(email);
CREATE INDEX ON users(status);

-- Device Tokens
CREATE UNIQUE INDEX ON device_tokens(user_id, token);
CREATE INDEX ON device_tokens(user_id);
CREATE INDEX ON device_tokens(token);

-- Conversations
CREATE INDEX ON conversations(last_message_at DESC);

-- Conversation Members
CREATE UNIQUE INDEX ON conversation_members(conversation_id, user_id);
CREATE INDEX ON conversation_members(conversation_id);
CREATE INDEX ON conversation_members(user_id);
CREATE INDEX ON conversation_members(left_at);

-- Friendships
CREATE UNIQUE INDEX ON friendships(requester_id, addressee_id);
CREATE INDEX ON friendships(status);

-- Media Files
CREATE UNIQUE INDEX ON media_files(key);
CREATE INDEX ON media_files(uploaded_by);
CREATE INDEX ON media_files(conversation_id, created_at DESC);

-- Posts (no extra — uses PK and FK indexes)

-- Post Media
CREATE INDEX ON post_media(post_id, display_order);

-- Post Likes
CREATE UNIQUE INDEX ON post_likes(post_id, user_id);
CREATE INDEX ON post_likes(post_id);
CREATE INDEX ON post_likes(user_id, created_at DESC);

-- Post Comments
CREATE INDEX ON post_comments(post_id, created_at);
CREATE INDEX ON post_comments(parent_comment_id);
CREATE INDEX ON post_comments(user_id);

-- Comment Likes
CREATE UNIQUE INDEX ON comment_likes(comment_id, user_id);
CREATE INDEX ON comment_likes(comment_id);

-- Notification Logs
CREATE INDEX ON notification_logs(user_id, sent_at DESC);

-- AI Moderation Logs
CREATE INDEX ON ai_moderation_logs(message_id);
CREATE INDEX ON ai_moderation_logs(conversation_id, processed_at DESC);
CREATE INDEX ON ai_moderation_logs(is_flagged, processed_at DESC);

-- AI Usage Logs
CREATE INDEX ON ai_usage_logs(user_id, created_at DESC);
CREATE INDEX ON ai_usage_logs(feature, created_at DESC);

-- Document Metadata
CREATE INDEX ON document_metadata(conversation_id);
CREATE INDEX ON document_metadata(user_id);

-- Document Chunks
CREATE INDEX ON document_chunks(document_id);
-- IVFFlat vector index (pgvector) — managed via migration:
-- CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);
```

---

## Unique Constraints

```sql
-- Device Tokens
UNIQUE(user_id, token)

-- Conversation Members
UNIQUE(conversation_id, user_id)

-- Friendships
UNIQUE(requester_id, addressee_id)

-- Media Files
UNIQUE(key)

-- Post Likes
UNIQUE(post_id, user_id)

-- Comment Likes
UNIQUE(comment_id, user_id)

-- Notification Preferences
UNIQUE(user_id)
```

---

## Enum Types

### PostgreSQL Enums (TypeScript)

```typescript
// UserStatus
enum UserStatus { ACTIVE = 'active', INACTIVE = 'inactive', BANNED = 'banned' }

// ConversationType
type ConversationType = 'direct' | 'group';

// MemberRole (UpdateMemberRoleDtoRoleEnum)
enum MemberRole { OWNER = 'owner', ADMIN = 'admin', MEMBER = 'member' }

// FriendshipStatus
enum FriendshipStatus { PENDING = 'pending', ACCEPTED = 'accepted', BLOCKED = 'blocked' }

// MediaFileStatus
enum MediaFileStatus { PENDING = 'pending', UPLOADED = 'uploaded', DELETED = 'deleted' }

// MediaVisibility
enum MediaVisibility { PUBLIC = 'public', PRIVATE = 'private' }

// ReactionType (post likes)
enum ReactionType { LIKE = 'like', LOVE = 'love', HAHA = 'haha', WOW = 'wow', SAD = 'sad', ANGRY = 'angry' }

// PostVisibility
type PostVisibility = 'public' | 'friends' | 'only_me';

// PostMediaType
type PostMediaType = 'image' | 'video';

// NotificationChannel
enum NotificationChannel { PUSH = 'push', EMAIL = 'email', SMS = 'sms' }

// NotificationProvider
enum NotificationProvider { FCM = 'fcm', APNS = 'apns', MOCK = 'mock' }

// NotificationStatus
enum NotificationStatus { SENT = 'sent', FAILED = 'failed', PENDING = 'pending' }

// DocumentStatus
type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';
```

### ScyllaDB Value Types

```typescript
// Message reaction_type (ScyllaDB message_reactions)
type ChatReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

// ForwardedFrom.source_type
type MessageSourceType = 'text' | 'image' | 'file' | 'mixed';

// Idempotency status
type IdempotencyStatus = 'pending' | 'stored';
```

---

## Migration Guide

### Setup PostgreSQL

```bash
# Chạy TypeORM migrations
pnpm run migration:run

# Hoặc với Docker
docker compose exec postgres psql -U postgres -d zaloclone -f infra/postgres/schema.sql
```

> **Lưu ý pgvector:** `document_chunks.embedding` cần `CREATE EXTENSION IF NOT EXISTS vector;` và migration riêng. TypeORM `synchronize` sẽ không tự tạo đúng column type.

### Setup ScyllaDB

```bash
# Chạy schema
cqlsh -f infra/scylla/schema.cql

# Hoặc với Docker
docker compose exec scylla cqlsh -f /schema.cql
```

### ScyllaDB Migration (Incremental)

Thêm column mới vào bảng hiện có:

```sql
-- Ví dụ: thêm forwarded_from (đã được thêm trong forward-message feature)
ALTER TABLE messages_by_conversation ADD forwarded_from text;

-- Tạo bảng mới (messages_by_id)
CREATE TABLE IF NOT EXISTS messages_by_id (...);
```

> ScyllaDB `ALTER TABLE ADD` là non-blocking, an toàn trên cluster đang live.

### TypeORM Auto-sync (Development only)

```typescript
// DatabaseModule tự động sync khi NODE_ENV=development
synchronize: config.nodeEnv === 'development'
// Không dùng synchronize trong production
```

---

## Environment Variables

```env
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=zaloclone

# ScyllaDB
SCYLLA_CONTACT_POINTS=127.0.0.1
SCYLLA_LOCAL_DATACENTER=datacenter1
SCYLLA_KEYSPACE=chat

# Redis
REDIS_URL=redis://localhost:6379
```
