# Backend Architecture (Zalo clone MVP)

## Overview

This repo is a NestJS **monorepo** implementing an event-driven chat backend.

Key goals for the MVP:

- Real-time messaging via **Socket.IO** (ws-gateway)
- Event-driven processing via **Kafka** (Nest microservices transport)
- Message persistence in **ScyllaDB** (mandatory)
- Presence as a separate service (**presence-service**)
- Media upload via **S3 presigned URL** (media-service)
- Notifications via **mock provider** (notification-service)

![alt text](image.png)

## Apps

- `apps/api-gateway`: HTTP REST edge (health now; will host auth/profile/search later)
- `apps/ws-gateway`: Socket.IO edge + Kafka consumer group `ws-gateway-fanout`
- `apps/chat-service`: Kafka consumer group `chat-service-persist`, persists Scylla, emits canonical events
- `apps/presence-service`: Kafka consumer group `presence-service-state`, maintains TTL presence and emits updates
- `apps/media-service`: HTTP endpoints for S3 presign + upload confirm, emits media events
- `apps/notification-service`: Kafka consumer, uses mock provider and emits sent events

## Shared libs

- `libs/contracts`: stable DTOs and topic/event names (Kafka + Socket.IO)
- `libs/kafka`: Kafka client module + helper to build microservice options
- `libs/scylla`: Scylla client + message repository (MVP tables)
- `libs/auth`: JWT verify + WS guard
- `libs/config`: env reader (minimal)
- `libs/logger`: Nest Logger wrapper
- `libs/mvp-access`: hardcoded conversation membership checks (replace later)

## Messaging Contracts (Kafka)

Topics:

- `chat.message.send` (command)
- `chat.message.created` (event)
- `presence.connect`, `presence.disconnect`, `presence.heartbeat` (commands)
- `presence.updated` (event)
- `media.upload.requested`, `media.uploaded` (events)
- `notification.requested`, `notification.sent` (events)

Contracts live in `libs/contracts`.

## Realtime Contracts (Socket.IO)

Events:

- Client → Server: `chat:join`, `chat:send`, `presence:heartbeat`
- Server → Client: `chat:message`, `presence:update`, `chat:ack`

Contracts live in `libs/contracts`.

## Data Model (ScyllaDB)

MVP tables:

- `messages_by_conversation` with PK `((conversation_id), created_at, message_id)`
- `idempotency_by_message_id` with PK `(message_id)`

Ordering is **(created_at, message_id)**.

Schema file: `infra/scylla/schema.cql`.
