# Backend Architecture (Zalo Clone)

## Overview

This is a NestJS **monorepo** implementing a production-ready, event-driven real-time chat platform with microservices architecture.

**Core Architecture Goals:**

- Real-time messaging via **Socket.IO** (ws-gateway)
- Event-driven processing via **Kafka** (asynchronous communication)
- Dual database strategy: **PostgreSQL** (relational data) + **ScyllaDB** (message storage)
- Service separation: Authentication, Social Graph, Chat, Presence, Media, Notifications
- Backend-for-Frontend (BFF) pattern for client API aggregation
- Firebase integration for phone authentication

![alt text](image.png)

## Architecture Layers

### 1. Client-Facing Layer (HTTP REST + WebSocket)

#### **bff-service** (`:3000`)

**Backend-for-Frontend** - Main HTTP API gateway for clients

- **Purpose**: Aggregates and proxies requests to internal microservices
- **Routes**: `/api/auth`, `/api/users`, `/api/friends`, `/api/conversations`, `/api/messages`
- **Communication**: Synchronous HTTP calls to SSO, Interaction, and Chat services
- **Features**:
  - User authentication & profile management (via SSO service)
  - Friend requests & relationships (via Interaction service)
  - Conversation CRUD (via Interaction service)
  - Message history retrieval (via Chat service)
  - Swagger documentation at `/docs`
- **Technology**: NestJS, TypeScript, OpenAPI client generation

#### **ws-gateway** (`:3001`)

**Real-Time WebSocket Gateway** - Socket.IO edge server

- **Purpose**: Handles WebSocket connections and real-time message delivery
- **Communication**:
  - Receives events from clients via Socket.IO
  - Publishes commands to Kafka
  - Consumes Kafka events (group: `ws-gateway-fanout`)
  - Broadcasts events to connected clients
- **Socket.IO Events**:
  - Client → Server: `chat:join`, `chat:send`, `chat:edit`, `chat:delete`, `chat:react`, `presence:heartbeat`
  - Server → Client: `chat:message`, `chat:message:updated`, `chat:message:deleted`, `chat:reaction:added`, `presence:update`
- **Scaling**: Redis adapter for horizontal scaling
- **Auth**: JWT token validation via handshake headers

### 2. Business Logic Layer (HTTP Microservices)

#### **sso-service** (`:5001`)

**Authentication & User Management** - PostgreSQL + TypeORM

- **Responsibilities**:
  - User registration with Firebase phone authentication
  - Login/logout with JWT token management
  - Password reset via OTP
  - QR code authentication for desktop login
  - User profile CRUD
  - User search by phone/name
- **Database**: PostgreSQL (users, sessions, refresh tokens)
- **Modules**: `auth`, `users`
- **API**: `/api/auth/*`, `/api/users/*`
- **Swagger**: `/docs`

#### **interaction-service** (`:5004`)

**Social Graph & Conversations** - PostgreSQL + TypeORM

- **Responsibilities**:
  - Friend request management (send, accept, reject, cancel)
  - Friend list & blocking
  - Conversation creation (direct & group)
  - Conversation membership & permissions
  - Conversation settings
- **Database**: PostgreSQL (friendships, friend_requests, conversations, conversation_members)
- **Modules**: `friends`, `conversations`
- **API**: `/api/friends/*`, `/api/conversations/*`
- **Swagger**: `/docs`

#### **chat-service** (`:5002`)

**Message Persistence & Retrieval** - ScyllaDB + HTTP + Kafka

- **Responsibilities**:
  - HTTP API for message history retrieval
  - Kafka consumer for message persistence
  - Message CRUD operations in ScyllaDB
  - Reaction management
  - Idempotency handling
- **Database**: ScyllaDB keyspace `chat`
- **Kafka Consumer Group**: `chat-service-persist`
- **HTTP API**: `/v1/messages/:conversationId` (GET messages, GET reactions)
- **Kafka Topics Consumed**:
  - `chat.message.send` → persist + emit `chat.message.created`
  - `chat.message.edit` → update + emit `chat.message.updated`
  - `chat.message.delete` → soft delete + emit `chat.message.deleted`
  - `chat.reaction.add` → add reaction + emit `chat.reaction.added`
  - `chat.reaction.remove` → remove reaction + emit `chat.reaction.removed`

#### **media-service** (`:3003`)

**File Upload & Storage** - S3 (LocalStack)

- **Responsibilities**:
  - Generate presigned S3 upload URLs
  - Generate presigned download URLs
  - Thumbnail generation (for images)
  - File metadata management
- **Storage**: AWS S3 (LocalStack for local dev)
- **API**: `/v1/media/presign/upload`, `/v1/media/presign/download`
- **Kafka Events**: `media.uploaded`, `media.thumbnail.generated`

### 3. Background Processing Layer (Kafka Microservices)

#### **presence-service**

**User Online Status & Heartbeat** - Redis + Kafka

- **Purpose**: Track user online/offline status with TTL
- **Kafka Consumer Group**: `presence-service-state`
- **Topics Consumed**: `presence.connect`, `presence.disconnect`, `presence.heartbeat`
- **Events Emitted**: `presence.updated`
- **Storage**: Redis with TTL for presence state

#### **notification-service**

**Push Notifications** - Kafka

- **Purpose**: Send notifications to users (FCM, APNS, mock provider)
- **Kafka Consumer**: Listens to `notification.requested`
- **Events Emitted**: `notification.sent`
- **Provider**: Firebase Cloud Messaging (FCM) + mock provider

## Data Flow Examples

### Message Send Flow

```
1. Client → ws-gateway (Socket.IO: chat:send)
2. ws-gateway → Kafka (publish: chat.message.send)
3. chat-service (Kafka consumer) → ScyllaDB (persist message)
4. chat-service → Kafka (publish: chat.message.created)
5. ws-gateway (Kafka consumer) → Socket.IO broadcast (chat:message)
6. notification-service → FCM push notification
```

### Friend Request Flow

```
1. Client → bff-service (POST /api/friends/requests)
2. bff-service → interaction-service (HTTP call)
3. interaction-service → PostgreSQL (insert friend_request)
4. interaction-service → Kafka (publish: friend.request.send)
5. ws-gateway → Socket.IO broadcast to recipient
6. notification-service → FCM push notification
```

### Message History Retrieval

```
1. Client → bff-service (GET /api/messages/:conversationId)
2. bff-service → chat-service (HTTP call)
3. chat-service → ScyllaDB (query messages_by_conversation)
4. chat-service → bff-service (paginated response)
5. bff-service → Client (JSON response)
```

## Shared Libraries (`libs/`)

### Core Infrastructure

- **`@libs/contracts`**: Centralized event definitions (Kafka topics + Socket.IO events + DTOs)
- **`@libs/kafka`**: Kafka client configuration and microservice helpers
- **`@libs/database`**: TypeORM configuration, PostgreSQL DataSource, entities
- **`@libs/scylla`**: ScyllaDB client and repository patterns
- **`@libs/redis`**: Redis client for caching and Socket.IO adapter

### Authentication & Authorization

- **`@libs/auth`**: JWT service, guards (`JwtAuthGuard`, `WsAuthGuard`), decorators
- **`@libs/firebase`**: Firebase Admin SDK integration for phone auth

### Cross-Cutting Concerns

- **`@libs/config`**: Environment variable management
- **`@libs/logger`**: Structured logging service
- **`@libs/interceptors`**: Response transformation, error handling, logging
- **`@libs/middleware`**: Request logging, API key validation, IP filtering
- **`@libs/decorator`**: Custom decorators (`@CurrentUser`, `@AccessToken`, `@Public`, `@Roles`)

### Client Generation

- **`@app/clients`**: Auto-generated TypeScript clients from OpenAPI specs
  - `SsoClientService` (from sso-service OpenAPI)
  - `InteractionClientService` (from interaction-service OpenAPI)
  - `ChatClientService` (from chat-service OpenAPI)

### MVP Temporary

- **`@libs/mvp-access`**: Hardcoded conversation membership (to be replaced with relation-service)

## Event Contracts (Kafka)

### Chat Events

- **Commands**: `chat.message.send`, `chat.message.edit`, `chat.message.delete`, `chat.reaction.add`, `chat.reaction.remove`
- **Events**: `chat.message.created`, `chat.message.updated`, `chat.message.deleted`, `chat.reaction.added`, `chat.reaction.removed`

### Presence Events

- **Commands**: `presence.connect`, `presence.disconnect`, `presence.heartbeat`
- **Events**: `presence.updated`

### Friend/Relation Events

- **Commands**: `friend.request.send`, `friend.request.respond`, `friend.request.cancelled`
- **Events**: `friend.removed`

### Media Events

- **Events**: `media.upload.requested`, `media.uploaded`, `media.thumbnail.generated`

### Notification Events

- **Events**: `notification.requested`, `notification.sent`

### Auth Events

- **Events**: `auth.qr.confirmed`, `auth.qr.rejected`

All contracts defined in: `libs/contracts/src/kafka/`

## WebSocket Events (Socket.IO)

### Client → Server

- `chat:join` - Join conversation room
- `chat:leave` - Leave conversation room
- `chat:send` - Send message
- `chat:edit` - Edit message
- `chat:delete` - Delete message
- `chat:react` - Add reaction
- `chat:unreact` - Remove reaction
- `chat:typing` - Typing indicator
- `presence:heartbeat` - Keep-alive ping

### Server → Client

- `chat:message` - New message broadcast
- `chat:message:updated` - Message edited
- `chat:message:deleted` - Message deleted
- `chat:reaction:added` - Reaction added
- `chat:reaction:removed` - Reaction removed
- `chat:ack` - Message acknowledgment
- `presence:update` - User status change
- `qr:confirmed` - QR login confirmed
- `qr:rejected` - QR login rejected
- `friend:request:send` - Friend request received

All contracts defined in: `libs/contracts/src/ws/events.ts`

## Data Models

### PostgreSQL (TypeORM)

**Tables**: users, refresh_tokens, qr_sessions, friendships, friend_requests, conversations, conversation_members

Schema files:

- `migrations/*.ts` (TypeORM migrations)
- `libs/database/src/entities/*.entity.ts` (Entity definitions)

### ScyllaDB (Cassandra)

**Keyspace**: `chat`

**Tables**:

- `messages_by_conversation` - Primary message storage
  - Partition Key: `conversation_id`
  - Clustering: `(created_at ASC, message_id ASC)`
  - Columns: `sender_id`, `body`, `message_type`, `media_url`, `media_metadata`, `reply_to_message_id`, `is_deleted`, `edited_at`
- `idempotency_by_message_id` - Duplicate detection
  - Partition Key: `message_id`
  - Used to prevent duplicate message processing

- `reactions_by_message` - Message reactions
  - Partition Key: `message_id`
  - Clustering: `(user_id ASC)`

Schema file: `infra/scylla/schema.cql`

## Technology Stack

- **Runtime**: Node.js (NestJS framework)
- **Language**: TypeScript
- **Databases**: PostgreSQL 15, ScyllaDB 5.4
- **Message Broker**: Apache Kafka 7.6
- **Cache**: Redis 7.4
- **WebSocket**: Socket.IO 4.8
- **Storage**: AWS S3 (LocalStack for local dev)
- **Auth**: JWT, Firebase Admin SDK
- **API Docs**: Swagger/OpenAPI
- **ORM**: TypeORM (PostgreSQL), Cassandra Driver (ScyllaDB)
- **Build**: pnpm workspaces, Nest CLI
- **Containerization**: Docker, Docker Compose
