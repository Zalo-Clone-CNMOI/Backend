-- Keyspace
CREATE KEYSPACE IF NOT EXISTS chat
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE chat;

-- Message history by conversation (ordering: created_at, message_id)
CREATE TABLE IF NOT EXISTS messages_by_conversation (
  conversation_id text,
  created_at bigint,
  message_id text,
  sender_id text,
  body text,
  PRIMARY KEY ((conversation_id), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at ASC, message_id ASC);

-- Idempotency marker
CREATE TABLE IF NOT EXISTS idempotency_by_message_id (
  message_id text PRIMARY KEY,
  conversation_id text,
  created_at bigint,
  status text
);
