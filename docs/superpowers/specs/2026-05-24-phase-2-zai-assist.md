# Phase 2 — Zai Assist: Catch-up Summary + Translation

Branch: `feat/phase-2-zai-assist` · Status: implemented, pending PR · Date: 2026-05-24

## Context

Phase 1 (PR #30) shipped the Zai foundation. Phase 2 is the first batch of user-facing Zai features. Originally three "quick wins" were scoped; after review:

- **Catch-up summary** (idea 4) — KEPT. "What did I miss?" summary of a user's unread messages in a conversation.
- **Translation** (idea 5) — KEPT. Translate a piece of text on demand.
- **Post-call summary** (idea 2) — **DEFERRED**. Calls are voice/video with no transcript; nothing textual to summarize. Revisit when a transcript source exists.

Both kept features are **per-user and private**, delivered as **synchronous "private HTTP cards"**: the result returns only to the requesting user and is **NOT** persisted as a chat message. They deliberately do **not** use the Phase 1 `chat.ai.message` pipeline (which posts to all members). They mirror the existing `entity-info` HTTP pattern:

```
FE → BFF controller (JWT, @CurrentUser) → BFF AiAssistService → AiCoreClientService (axios)
   → ai-core HTTP controller → engine via AiGatewayService.complete() → JSON response
```

Both LLM engines already existed (`SummaryEngine` informed `CatchUpEngine`; `TranslationEngine` reused as-is); both cache in Redis and enforce per-user token budgets through `AiGatewayService.complete()`.

## What was built

**Contracts** — `libs/contracts/src/kafka/ai.events.ts`: added `AiCatchUpResultEvent` and `'catch_up'` to `AiFeatureType`. Reused existing `AiTranslateResultEvent`.

**ai-core-service**
- `modules/catch-up/` — `CatchUpEngine` (fetch ScyllaDB → filter unread window `created_at > since`, exclude deleted → cap 50 → catch-up prompt → `gateway.complete` → Redis cache ~10 min), `CatchUpController` (`@Controller('catch-up')` → `GET /api/catch-up`), query DTO, module. Edge cases: zero-unread and all-media windows short-circuit with NO LLM call; `lastReadAt` null → newest-K window; ScyllaDB/gateway failures wrapped; cache-hit returns the current caller's identity; metrics recorded via `AiMetricsService`.
- `modules/translation/translation.controller.ts` (`@Controller('translate')` → `POST /api/translate`, `@HttpCode(200)`) + request DTO; wired into the existing `TranslationModule`. Reuses `TranslationEngine` unchanged.
- `prompt-builder.service.ts`: added `buildCatchUpPrompt`.

**ai-core HTTP client (hand-written axios — no codegen)** — `libs/clients/src/ai-core-client/`: `ZaiAssistApi` (`getCatchUpSummary` GET `/catch-up`, `translate` POST `/translate`), registered in `AiCoreClientModule` (both `register` + `registerAsync`), wrapped by `AiCoreClientService.getCatchUpSummary` / `translate` (camelCase→snake_case mapping, `handleError` on failure).

**bff-service** — `modules/ai-assist/`: `AiAssistController` (`@Controller('ai-assist')`, JWT, throttled 30/min): `GET conversations/:conversationId/catch-up`, `POST translate`. `AiAssistService`: catch-up calls `interactionClient.getConversationById` (enforces membership AND returns the caller's `mySettings.lastReadAt` → `since` ms, with a NaN guard) then `aiCoreClient.getCatchUpSummary`; translate passes through. Response DTOs (camelCase). Registered in `bff-service.module.ts`.

## Key decisions / notes

- **`lastReadAt` via narrow cast:** interaction-service returns `mySettings.lastReadAt` at runtime (`conversation-mapper.ts` `toDetailResponse`), but the **generated** `ConversationDetailDto` client type is stale and omits `mySettings`. The BFF reads it through a documented narrow cast. Correct at runtime; see Manual Ops #4 to make it type-safe.
- **Trust model:** ai-core endpoints trust the BFF-supplied `user_id` (port 5005 firewalled), identical to `entity-info`.
- **Abuse guards:** endpoint throttle (30/min, matching entity-info) + per-user daily token budget in `AiGatewayService.complete()`.

## N. Manual Operations Required (Post-Merge, Pre-Production)

This phase adds **no** migration, env var, or Kafka topic.

### Required (in order)
1. **Deploy order:** deploy/restart **ai-core-service FIRST** (it serves the new `/api/catch-up` and `/api/translate`), **then bff-service** (which calls them). Deploying BFF first → 404s until ai-core is up.
2. Confirm `AI_CORE_SERVICE_URL` and `INTERACTION_SERVICE_URL` are set correctly in the target env. Both are **already used** by existing BFF modules; no NEW variable is introduced. Defaults: `http://ai-core-service:5005/api`, `http://interaction-service:5004/api`.

### Recommended (not blocking)
3. Keep ai-core port 5005 firewalled from the public internet (endpoints trust the BFF-supplied `user_id`).
4. **Regenerate the interaction client** so `ConversationDetailDto.mySettings.lastReadAt` is type-safe, then replace the narrow cast in `apps/bff-service/src/modules/ai-assist/ai-assist.service.ts` with a typed access. Until then, catch-up works correctly at runtime. (Note: codegen on this repo covers sso/interaction/chat/media; run the interaction codegen after exporting an updated OpenAPI spec.)

### Smoke test after deploy
5. `POST /ai-assist/translate { "text": "Xin chào", "target_language": "en" }` as a logged-in user → `translatedBody` ≈ "Hello".
6. As a member of a conversation with unread messages: `GET /ai-assist/conversations/:id/catch-up` → `hadUnread: true` + non-empty `summary`. Call again immediately → `cached: true`. As a NON-member → 403/404 with no token spend.

### What does NOT require manual action
- No DB migration (uses existing `lastReadAt`).
- No new env vars.
- No new Kafka topics / consumers.
- No `docker-compose.prod.yml` changes (no new env to inject).
- No codegen for **ai-core** (its client is hand-written).

## Deferred / follow-ups
- Post-call summary (idea 2) — until a transcript source exists.
- Sender attribution in the catch-up prompt (currently bare message text) — quality enhancement requiring sender-name resolution.
- ScyllaDB `since`-pushdown (`WHERE created_at > ?`) instead of fetch-200-then-filter — performance optimization.
- Regenerate interaction client (Manual Ops #4).
- L2/L3 memory remains out of scope (stays L1 per `ai-memory-strategy.md`).
