-- =============================================================================
-- Migration 002: Add message mentions tables
-- Date: 2026-05-03
-- =============================================================================

USE chat;

-- Sentinel '__ALL__' is used in mentioned_user_id when mention_type='all'.
-- Real user_ids are UUIDs from PostgreSQL so collision is impossible.

-- Table: mentions_by_message
-- Query: list all users mentioned in a single message
CREATE TABLE IF NOT EXISTS mentions_by_message (
    message_id          text,
    mentioned_user_id   text,
    conversation_id     text,
    mention_type        text,
    "offset"            int,
    length              int,
    sender_id           text,
    created_at          bigint,
    PRIMARY KEY ((message_id), mentioned_user_id)
);

-- Table: mentions_by_user (inbox view)
-- Query: "give me my last 50 mentions" with DESC pagination
CREATE TABLE IF NOT EXISTS mentions_by_user (
    mentioned_user_id   text,
    created_at          bigint,
    message_id          text,
    conversation_id     text,
    sender_id           text,
    mention_type        text,
    is_read             boolean,
    PRIMARY KEY ((mentioned_user_id), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at DESC, message_id ASC);

-- Table: unread_mention_count_by_conversation
-- Counter table — atomic increment per (user, conversation) for badge UI
CREATE TABLE IF NOT EXISTS unread_mention_count_by_conversation (
    user_id             text,
    conversation_id     text,
    count               counter,
    PRIMARY KEY ((user_id), conversation_id)
);

-- Add inline mentions JSON column for fast hydration on fetch
-- NOTE: ScyllaDB does NOT support `IF NOT EXISTS` for ADD COLUMN.
-- Run-once: re-running this CQL on an already-altered table will produce error
-- "Invalid column name mentions because it conflicts with an existing column".
-- The init script tolerates this error (see package.json change).
ALTER TABLE messages_by_conversation ADD mentions text;
