-- =============================================================================
-- ZaloClone Database Schema - ScyllaDB
-- Generated: 2026-01-12
-- =============================================================================

-- Keyspace for chat messages
CREATE KEYSPACE IF NOT EXISTS chat
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE chat;

-- =============================================================================
-- MESSAGES DOMAIN
-- =============================================================================

-- Table: messages_by_conversation
-- Lưu trữ tin nhắn theo conversation, sắp xếp theo thời gian
-- Partition Key: conversation_id (mỗi conversation là 1 partition)
-- Clustering: created_at, message_id (sắp xếp tin nhắn theo thời gian)
CREATE TABLE IF NOT EXISTS messages_by_conversation (
    conversation_id text,
    created_at bigint,
    message_id text,
    sender_id text,
    body text,
    attachments text,           -- JSON array of attachments
    reply_to_message_id text,   -- ID của tin nhắn được reply
    edited_at bigint,
    deleted_at bigint,
    PRIMARY KEY ((conversation_id), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at ASC, message_id ASC)
  AND default_time_to_live = 0
  AND gc_grace_seconds = 864000;

-- =============================================================================
-- IDEMPOTENCY DOMAIN
-- =============================================================================

-- Table: idempotency_by_message_id
-- Đảm bảo message không duplicate khi client retry
CREATE TABLE IF NOT EXISTS idempotency_by_message_id (
    message_id text PRIMARY KEY,
    conversation_id text,
    created_at bigint,
    status text                 -- pending, stored, failed
) WITH default_time_to_live = 604800; -- TTL 7 days

-- =============================================================================
-- MESSAGE REACTIONS DOMAIN
-- =============================================================================

-- Table: message_reactions
-- Lưu trữ reactions của tin nhắn
-- Query pattern: Lấy tất cả reactions của 1 message
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id text,
    user_id text,
    reaction_type text,         -- like, love, haha, wow, sad, angry
    created_at bigint,
    PRIMARY KEY (message_id, user_id)
);

-- =============================================================================
-- MESSAGE READ RECEIPTS DOMAIN
-- =============================================================================

-- Table: message_read_receipts
-- Lưu trữ trạng thái đã đọc của tin nhắn
-- Query pattern: Kiểm tra ai đã đọc message nào
CREATE TABLE IF NOT EXISTS message_read_receipts (
    conversation_id text,
    message_id text,
    user_id text,
    read_at bigint,
    PRIMARY KEY ((conversation_id, message_id), user_id)
);

-- Table: last_read_by_user
-- Lưu trữ message cuối cùng user đã đọc trong mỗi conversation
-- Query pattern: Tính unread count cho user trong conversation
CREATE TABLE IF NOT EXISTS last_read_by_user (
    user_id text,
    conversation_id text,
    last_read_message_id text,
    last_read_at bigint,
    PRIMARY KEY ((user_id), conversation_id)
);

-- =============================================================================
-- TIMELINE POSTS FEED (Optional - for high-scale timeline)
-- =============================================================================

-- Table: timeline_feed_by_user
-- Lưu trữ feed timeline của mỗi user (fan-out on write pattern)
-- Dùng khi cần scale timeline feed với lượng lớn users
CREATE TABLE IF NOT EXISTS timeline_feed_by_user (
    user_id text,
    created_at bigint,
    post_id text,
    author_id text,
    PRIMARY KEY ((user_id), created_at, post_id)
) WITH CLUSTERING ORDER BY (created_at DESC, post_id DESC)
  AND default_time_to_live = 2592000; -- TTL 30 days

-- =============================================================================
-- TYPING INDICATORS (Use Redis instead - shown here for reference)
-- =============================================================================

-- Note: Typing indicators should use Redis with TTL instead of ScyllaDB
-- Redis key pattern: typing:{conversation_id}:{user_id} -> TTL 3s

-- =============================================================================
-- PRESENCE CACHE (Use Redis instead - shown here for reference)  
-- =============================================================================

-- Note: Presence should use Redis with TTL instead of ScyllaDB
-- Redis key pattern: presence:user:{user_id} -> JSON with TTL 60s

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
