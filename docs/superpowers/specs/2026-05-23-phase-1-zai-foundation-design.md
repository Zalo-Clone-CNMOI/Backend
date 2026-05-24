# Phase 1 — Zai AI Conversation Foundation (Design Spec)

**Date:** 2026-05-23
**Author:** Claude + locdx
**Status:** Draft — pending user review
**Related:** This is Phase 1 of a 4-phase roadmap for AI-enhanced UX. Phases 2-4 will be designed separately after Phase 1 ships.

---

## 1. Goal

Build the minimal infrastructure that allows the `ai-core-service` to send messages into any conversation under the identity of a single system AI bot named **"Zai"**. After Phase 1, any engine inside `ai-core-service` (translation, summary, document, future engines) can publish a message to a conversation; the message appears on the frontend exactly like a normal text message from a user whose `full_name = "Zai"`.

Phase 1 ships **infrastructure only** — no end-user feature. Feature triggers (document analysis chat, post-call summary, etc.) are deferred to Phases 2-4.

---

## 2. Brand & Naming

- The system AI is named **Zai** (single bot, single identity).
- All user-facing strings, seed data, env var documentation, and default values use **"Zai"** — never "AI Assistant", "Bot", or other generic names.
- The bot's `User` row carries `full_name = 'Zai'`. Frontend resolves `sender_id → User.fullName` via existing channels, so "Zai" appears automatically wherever a sender name is displayed.

---

## 3. Scope

### In scope

1. Add `ConversationType.AI_ASSISTANT` enum value
2. Add `ai_context JSONB` column to `conversations` table
3. Seed a single Zai bot user with a fixed UUID (`AI_BOT_USER_ID` env var)
4. New Kafka topic `chat.ai.message` (ai-core → chat-service trust boundary)
5. `AiChatPublisher` helper in `ai-core-service`
6. `AiMessageConsumer` in `chat-service` (validates + persists + fans out via existing `chat.message.created` event)
7. Extend `LlmCompletionOptions.messages` to accept multimodal content (text + image), so future engines can pass images without re-architecture
8. Helper service `AiConversationFactoryService` in `interaction-service` for creating AI conversations (used by Phase 2-3 triggers)

### Out of scope (deferred to later phases)

- BFF/orchestrator routing of *user* messages in AI_ASSISTANT conversations to specific AI engines (Phase 3)
- Memory layer beyond what each engine fetches itself (see §10)
- Feature triggers (document upload → chat, post-call → summary, etc.)
- Frontend changes (frontend already handles `chat.message.created` and `User.fullName`)
- AI bot authentication / multi-bot support (single Zai bot only)
- Streaming AI responses (`is_streaming` flag is reserved but not implemented)

---

## 4. Architecture

```
┌─────────────────── ai-core-service ───────────────────────────┐
│                                                                 │
│  Any engine (Document, Summary, Translation, ...)               │
│       │                                                         │
│       ▼                                                         │
│  AiChatPublisher.send({                                         │
│    conversation_id, body, attachments?, metadata?               │
│  })                                                             │
│       │                                                         │
└───────┼─────────────────────────────────────────────────────────┘
        │ Kafka topic: chat.ai.message
        ▼
┌────────────── chat-service / consumers ───────────────────────┐
│                                                                 │
│  AiMessageConsumer                                              │
│   1. Validate sender_id === config.zaiBotUserId                │
│   2. Validate conversation exists, not disbanded               │
│   3. Persist to ScyllaDB via existing MessageRepository        │
│   4. Update Conversation.lastMessageId + lastMessageAt          │
│   5. Emit chat.message.created (REUSE existing topic)          │
│                                                                 │
└───────┬─────────────────────────────────────────────────────────┘
        │ Kafka topic: chat.message.created  (no new topic)
        ▼
┌───────────── ws-gateway / chat-fanout.consumer ───────────────┐
│                                                                 │
│  Existing onMessageCreated handler — fans out to all members.  │
│  Zero changes here. Frontend treats Zai messages identically   │
│  to user messages because sender_id resolves to Zai's User row.│
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Key design choice — reuse `chat.message.created`:** Zai messages flow through the *same* fan-out and storage path as human messages. The only new piece is the **inbound** topic `chat.ai.message` (which establishes the trust boundary). Outbound to frontend is unchanged. This minimizes coupling and frontend churn.

---

## 5. Components & Files

| # | Path | Change |
|---|------|--------|
| 1 | `libs/constant/src/enum.ts` | Add `AI_ASSISTANT = 'ai_assistant'` to `ConversationType` enum |
| 2 | `libs/database/migrations/<timestamp>-add-zai-foundation.ts` | New migration: (a) add `ai_context JSONB NULL` column to `conversations`; (b) seed Zai user row (idempotent `ON CONFLICT DO NOTHING`) |
| 3 | `libs/database/src/entities/conversation.entity.ts` | Add `@Column({ type: 'jsonb', nullable: true, name: 'ai_context' }) aiContext: AiConversationContext \| null` |
| 4 | `libs/contracts/src/kafka/topics.ts` | Add `ChatAiMessage: 'chat.ai.message'` to `KafkaTopics` |
| 5 | `libs/contracts/src/kafka/chat.events.ts` | Add `ChatAiMessageCommand` interface + `AiMessageMetadata` interface |
| 6 | `libs/contracts/src/types/ai-conversation.ts` (new) | Export `AiConversationContext` interface |
| 7 | `libs/config/src/config.ts` | Add `zaiBotUserId` config field reading `AI_BOT_USER_ID` env var (default for dev: `00000000-0000-0000-0000-0000000000a1`) |
| 8 | `libs/config/src/config.schema.ts` (or equivalent validation) | Validate `AI_BOT_USER_ID` is a valid UUID v4 |
| 9 | `libs/contracts/src/llm/multimodal.ts` (new, or extend existing) | Extend `LlmChatMessage` content to support `string \| LlmContentPart[]` where `LlmContentPart = { type: 'text', text } \| { type: 'image_url', url, mime_type? }` |
| 10 | `apps/ai-core-service/src/transport/ai-chat.publisher.ts` (new) | Kafka publisher wrapper. Single method: `send(input: Omit<ChatAiMessageCommand, 'sender_id' \| 'created_at'>): Promise<void>` (publisher injects `sender_id` from config, `created_at` from now) |
| 11 | `apps/ai-core-service/src/transport/ai-chat.publisher.spec.ts` (new) | Unit tests for publisher |
| 12 | `apps/chat-service/src/consumers/ai-message.consumer.ts` (new) | NestJS Kafka consumer for `chat.ai.message` |
| 13 | `apps/chat-service/src/consumers/test/ai-message.consumer.spec.ts` (new) | Unit tests covering: valid path, sender_id mismatch, missing conversation, disbanded conversation, idempotent redelivery |
| 14 | `apps/chat-service/src/consumers/consumers.module.ts` (or equiv) | Register `AiMessageConsumer` |
| 15 | `apps/interaction-service/src/modules/conversations/services/ai-conversation-factory.service.ts` (new) | `createZaiConversation(userId, context: AiConversationContext): Promise<Conversation>` — creates `AI_ASSISTANT` conversation with user + Zai bot as members |
| 16 | `apps/interaction-service/src/modules/conversations/services/ai-conversation-factory.service.spec.ts` (new) | Unit tests |
| 17 | `apps/interaction-service/src/modules/conversations/conversations.module.ts` | Provide and export `AiConversationFactoryService` |
| 18 | `docs/superpowers/specs/ai-memory-strategy.md` (new) | Roadmap doc for L1/L2/L3 memory strategy (see §10). Not code. |
| 19 | `docs/ENV_REQUIRED_CHECKLIST.md` | Add `AI_BOT_USER_ID` row |
| 20 | `infra/assets/zai-avatar.png` (or hosted URL — TBD with frontend) | Default avatar image for Zai. Stored URL goes in migration seed. **Open question:** locally bundled vs S3-hosted? See §11. |

---

## 6. Data Shapes

### 6.1 `AiConversationContext`

Stored in `Conversation.aiContext` (JSONB). Read by Phase 3+ orchestrators to decide which engine handles user replies in this conversation.

```typescript
export interface AiConversationContext {
  feature: 'document' | 'general';   // extended in later phases
  document_id?: string;              // present when feature === 'document'
  created_at: number;                // epoch ms
}
```

Phase 1 sets this on conversation creation. Phase 1 does not yet consume the field.

### 6.2 `ChatAiMessageCommand` (Kafka payload for `chat.ai.message`)

```typescript
export interface ChatAiMessageCommand {
  message_id: string;                  // UUID; idempotency key
  conversation_id: string;
  sender_id: string;                   // MUST equal config.zaiBotUserId — validated by consumer
  body: string;
  attachments?: MessageAttachment[];   // reuse existing MessageAttachment type
  metadata?: AiMessageMetadata;
  created_at: number;
  trace_id: string;
}

export interface AiMessageMetadata {
  feature: 'document' | 'translation' | 'summary' | 'general';
  sources?: Array<{ chunk_index: number; preview: string }>; // RAG citations
  tokens_used?: number;
  model?: string;
  parent_message_id?: string;          // which user message Zai is replying to
  is_streaming?: boolean;              // reserved; Phase 1 always omits
}
```

### 6.3 Multimodal `LlmChatMessage`

Update the existing `LlmChatMessage` (currently `{ role, content: string }`) so future engines can pass image content to providers that support vision (Claude Sonnet 4.6, GPT-4o, Gemini all support this natively):

```typescript
export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; url: string; mime_type?: string };
```

**Phase 1 scope:** only the *interface* is extended. Provider implementations (LocDoRouter, OpenAI, Anthropic, Gemini) keep their current text-only path; conversion logic is added in the phase where the first engine actually needs vision (likely Phase 3 document chat for image attachments).

### 6.4 Zai User Seed

```sql
INSERT INTO users (
  id, phone, password_hash, full_name, avatar_url, status,
  created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-0000000000a1',  -- AI_BOT_USER_ID env (default for dev)
  '+zai-system',                            -- unique sentinel, fails E.164 validation by design
  '!unreachable',                           -- bcrypt cannot produce this; login impossible
  'Zai',
  '/assets/zai-avatar.png',                 -- TBD — see §11
  'active',
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;
```

**Note:** The `phone` column has a unique constraint. The sentinel `+zai-system` is intentionally not a valid E.164 format — this guarantees no real user can ever collide with it during normal signup.

---

## 7. Trust Boundary & Security

| Concern | Mitigation |
|---------|-----------|
| Forged Zai messages from rogue services | `AiMessageConsumer` rejects any message where `sender_id !== config.zaiBotUserId`. In prod, also restrict Kafka topic ACLs so only `ai-core-service` can publish to `chat.ai.message`. |
| Zai user login attempted by attacker | `password_hash = '!unreachable'` — bcrypt verification can never succeed against this string. SSO service login flow already calls `bcrypt.compare` which returns false. |
| Replay attack (Kafka redelivery) | ScyllaDB primary key `(conversation_id, message_id)` makes inserts idempotent. Duplicate `message_id` writes silently no-op. |
| User accidentally added Zai to a normal group | Phase 1 doesn't expose `AiConversationFactoryService` to controllers. Only internal consumers/services can create AI conversations. Phase 2-3 triggers control this. |

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| `sender_id` mismatch | Log error with payload digest, drop message, no retry (poison pill) |
| `conversation_id` not found | Log error, drop |
| Conversation disbanded | Log warning, drop |
| ScyllaDB write fails (transient) | Existing `MessageRepository` retry path applies |
| ScyllaDB write fails (permanent) | Let Kafka redelivery handle it; consumer doesn't ack until success |
| Duplicate `message_id` (redelivery) | Idempotent insert on PK; treat as success |
| Conversation update (`lastMessageId`) race | Use existing chat-service helper (already handles this for human messages) |

---

## 9. Testing Strategy

### 9.1 Unit tests

- **`AiChatPublisher`**: produces correctly-shaped event; injects `sender_id` from config; passes through `attachments`, `metadata`
- **`AiMessageConsumer`**: 
  - Happy path: valid event → repository called, `chat.message.created` emitted
  - `sender_id` mismatch → no DB write, no emit
  - Missing conversation → no DB write, no emit
  - Disbanded conversation → no DB write, no emit
  - Duplicate `message_id` → exactly one persisted row (use real in-memory mock)
- **`AiConversationFactoryService`**: creates conversation with correct type, both members added, `aiContext` persisted

### 9.2 Integration test

End-to-end smoke: `AiChatPublisher.send()` → in-process Kafka mock → `AiMessageConsumer` → in-memory ScyllaDB test double → verify row exists with `sender_id = zaiBotUserId`, `chat.message.created` emitted to ws-gateway mock.

### 9.3 Migration test

- Migration up: `ai_context` column exists and is nullable; Zai user row exists with `id = AI_BOT_USER_ID`
- Migration down: column dropped, Zai user row removed
- Re-run migration up after down: idempotent (no constraint violation)

### 9.4 Coverage gates

Match existing project thresholds (20% branches, 25% functions, 40% lines per CI config).

---

## 10. Memory Architecture — Deferred Decision Recorded

Phase 1 deliberately ships **no memory layer**. Each AI engine that needs context loads it itself (the same pattern `SmartReplyEngine` uses today via `fetchContextMessages`).

A separate doc — `docs/superpowers/specs/ai-memory-strategy.md` — captures the full L1/L2/L3 roadmap and the criteria for when to add each level:

- **L1 — Recent message window** (load last N from ScyllaDB into prompt): adopt in Phase 3 when document chat needs back-and-forth memory. No RAG.
- **L2 — Rolling summary + window** (reuse `SummaryEngine` for older messages, full text for recent): adopt when measured conversation length warrants it.
- **L3 — Per-message embeddings / cross-conversation RAG**: not recommended for v1. Embedding cost + latency outweigh chat-app value. Revisit only if specific use case (e.g., "find that thing we discussed last month") appears.

This separation prevents premature optimization: Phase 1 stays small, Phase 3 makes an informed memory choice based on Phase 2 user feedback.

---

## 11. Open Questions

1. **Zai avatar hosting**: Bundle in `infra/assets/zai-avatar.png` and serve via media-service, or upload to S3 once and hardcode the URL? Recommendation: S3 (uniform with user avatars).
2. **Default UUID for dev** (`00000000-0000-0000-0000-0000000000a1`): does it conflict with any seeded test fixtures? Need grep before migration.
3. **Phone uniqueness sentinel** (`+zai-system`): confirm no validator strips it before INSERT (e.g., E.164 normalizer in sso-service). Need code review.

---

## 12. Migration Safety

- `ai_context JSONB NULL` column: backward compatible, no data rewrite, no downtime
- `ConversationType` enum extension: column is `varchar(20)`, not a PG enum, so no DDL needed for the type itself
- Zai user seed: idempotent via `ON CONFLICT DO NOTHING`
- Migration down path: drop column + delete Zai user; safe if no AI conversations exist yet (they won't until Phase 2+)

---

## 13. Acceptance Criteria

Phase 1 is complete when **all** are true:

1. Migration runs cleanly on a fresh DB *and* on a copy of staging data
2. `AI_BOT_USER_ID` env documented in `ENV_REQUIRED_CHECKLIST.md`
3. `AiChatPublisher.send()` from `ai-core-service` results in a row in ScyllaDB and a `chat.message.created` event delivered to ws-gateway
4. Sending with wrong `sender_id` produces no row, no event, and a logged error
5. Frontend (untouched) renders the Zai message with `full_name = "Zai"` and the configured avatar
6. All new unit tests pass; project coverage thresholds unchanged
7. `pnpm jest apps/ai-core-service apps/chat-service apps/interaction-service` passes
8. No new ESLint violations
9. `docs/superpowers/specs/ai-memory-strategy.md` exists and is referenced from this spec

---

## 14. Estimated Effort

~2-3 working days of focused implementation. Breakdown:

- Day 1: Migration, entity update, constants, config, contracts (~5h). Tests for migration.
- Day 2: `AiChatPublisher`, `AiMessageConsumer`, end-to-end integration test (~6h).
- Day 3: `AiConversationFactoryService`, multimodal interface scaffolding, docs, final polish + review (~4h).

---

## 15. Manual Operations Required (Post-Merge, Pre-Production)

These steps are NOT automated by the build, deploy, or migration tooling. Operations engineer or release manager **must perform each step in order** for every environment (dev → staging → production) before Phase 1 is considered live.

### Required (in order)

1. **⚠️ Set `DB_SSL=true` in production environment** — REGRESSION RISK
   - `libs/database/src/data-source.ts` was changed in this phase: SSL is no longer unconditional. It now respects the `DB_SSL` env var.
   - If your production Postgres requires SSL (managed DBs almost always do), failing to set this will cause **all migrations and entity queries to fail** with SSL handshake errors.
   - **Must be set BEFORE deploying the new code.**

2. **Verify pgvector extension on target Postgres**
   - Pre-existing AI migrations require `CREATE EXTENSION vector`. The Phase 1 migration itself does not need pgvector, but the migration chain will not complete on a fresh DB without it.
   - Recommended: use a Postgres image with pgvector pre-installed, e.g. `pgvector/pgvector:pg15`.
   - Local dev only: if you hit `extension "vector" does not exist`, update `docker-compose.yml`.

3. **Run the migration**
   - Command: `pnpm migration:up` (or `npm run typeorm -- migration:run -d libs/database/src/data-source.ts`)
   - Adds `ai_context jsonb` column to `conversations`, seeds the Zai user row (id `00000000-0000-0000-0000-0000000000a1`).
   - Idempotent — safe to re-run; uses `ON CONFLICT DO NOTHING` on the user INSERT.

4. **Set `ZAI_BOT_USER_ID` env var**
   - Value: the UUID of the Zai user seeded in step 3. Default is `00000000-0000-0000-0000-0000000000a1` (matches the migration default).
   - Affected services: `ai-core-service`, `chat-service`, `interaction-service`.
   - Dev has a fallback default; **production must set explicitly** to prevent silent drift if the migration default changes in a later phase.

5. **Deploy (or restart) the three affected services** so they pick up the new code: `ai-core-service`, `chat-service`, `interaction-service`.

### Recommended (not blocking)

6. **Upload Zai avatar to S3 and update the user row**
   - The migration seeds `avatar_url = NULL`. Frontend handles null with an initials placeholder, but a proper avatar improves UX.
   - Steps:
     1. Create or obtain a 256×256 (or similar) avatar image for Zai.
     2. Upload to your existing user-avatars S3 bucket / CDN.
     3. `UPDATE users SET avatar_url = '<URL>' WHERE id = '00000000-0000-0000-0000-0000000000a1';`

7. **Kafka topic ACLs for `chat.ai.message`** (production hardening)
   - Restrict producers to only `ai-core-service` to prevent message forgery from a compromised internal service.
   - The application code already validates `sender_id === zaiBotUserId` — this ACL is defense-in-depth.

### Smoke test after deploy

8. **End-to-end Zai message round-trip**
   - From inside the `ai-core-service` container (or via a temporary script): call `AiChatPublisher.send({ message_id, conversation_id, body, trace_id })` against a real existing conversation ID.
   - Expected outcome:
     - Row appears in ScyllaDB `messages_by_conversation` with `sender_id` equal to `ZAI_BOT_USER_ID`.
     - `ws-gateway` broadcasts `chat.message.created` to all members of that conversation.
     - Frontend (without changes) renders the Zai message with `full_name: "Zai"`.

### What does NOT require manual action

- No frontend changes required — Zai messages flow through the existing `chat.message.created` event.
- Kafka topic `chat.ai.message` does not need to be created manually if your cluster has `auto.create.topics.enable=true` (default). Otherwise, create it: `kafka-topics --create --topic chat.ai.message --partitions 3 --replication-factor 2`.
- No frontend env var updates.

---
