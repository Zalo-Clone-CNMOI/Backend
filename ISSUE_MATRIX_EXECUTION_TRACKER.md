# Issue Matrix Execution Tracker

## Objective

Close all remaining issue matrix gaps in risk-first order without breaking current flows, and enforce release gates before merge.

## Phase Mapping

| PR    | Phase                            | Priority | Scope                                                                                      | Status      |
| ----- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------ | ----------- |
| PR-01 | Baseline + Scope Lock            | Blocker  | Freeze matrix, baseline evidence, gate templates                                           | In Progress |
| PR-02 | Security/Auth Boundary           | Blocker  | Authz boundary, CORS hardening, QR socket binding, error envelope alignment                | In Progress |
| PR-03 | Data Consistency/Idempotency     | Blocker  | Atomic idempotency, immutable timestamp semantics, seen-marker race, telemetry             | In Progress |
| PR-04 | AI Safety/Moderation Enforcement | Blocker  | Fail-safe policy, enforcement events, conversation fanout, idempotent emit                 | In Progress |
| PR-05 | Validation/Contracts/Transport   | Blocker  | WS runtime validation, contract-first updates, retry/backoff/DLQ, WS/RPC error handling    | Not Started |
| PR-06 | Performance/Scalability          | High     | Batch membership checks, JwtAuthGuard cache+revocation, attachment ownership tightening    | Not Started |
| PR-07 | Environment + Dependency Hygiene | High     | Secret fallback removal, config schema validation, healthchecks, vulnerability remediation | Not Started |
| PR-08 | Regression Shield + Release Gate | Blocker  | Regression suites, codegen drift check, release gate lock, rollback playbook               | Not Started |

## Phase 0 Baseline Evidence (2026-04-12)

### Command Results

| Command                       | Result | Notes                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------ |
| pnpm run build:all            | Passed | All services compiled successfully                                 |
| pnpm run lint                 | Passed | ESLint completed with --fix                                        |
| pnpm run test:ci              | Failed | 1 failing test in chat-service messages URL formatting expectation |
| pnpm audit --audit-level=high | Failed | 72 vulnerabilities (6 critical, 37 high, 21 moderate, 8 low)       |

### Test Baseline Snapshot

- Test Suites: 1 failed, 45 passed, 46 total
- Tests: 1 failed, 649 passed, 650 total
- Coverage Summary:
  - Statements: 48.82%
  - Branches: 28.26%
  - Functions: 32.26%
  - Lines: 49.01%
- Known failing spec:
  - apps/chat-service/src/modules/messages/messages.service.spec.ts
  - Scenario: attachment URL building expects localhost format but gets S3 URL

### Dependency Audit Snapshot

- Total vulnerabilities: 72
- Severity distribution: 6 critical, 37 high, 21 moderate, 8 low
- High-impact packages observed in output:
  - handlebars
  - node-forge
  - picomatch
  - path-to-regexp
  - lodash
  - basic-ftp

## Decision Log (Locked)

- Reaction authorization: member-allowed in conversation scope.
- QR login hardening: strict server-verified socket binding.
- Moderation fallback policy: fail-closed.
- Delivery format: PR-based execution with effort estimates and rollback notes.

## Active Gap Matrix (Owner, Files, Tests, Done Criteria, Rollback)

| Gap                                             | Severity | Owner Service(s)                                                  | Primary Files                                                                                                                                                                                                | Tests to Add/Update                                                                                                                                                                                    | Done Criteria                                                                                               | Rollback Note                                                      |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Authoritative authz for edit/delete/reaction    | Blocker  | chat-service, ws-gateway                                          | apps/chat-service/src/consumers/persist-message.consumer.ts; apps/ws-gateway/src/socket/handlers/chat.handler.ts; apps/chat-service/src/utils/access.helper.ts                                               | apps/chat-service/src/consumers/persist-message.consumer.spec.ts; test/integration/chat-service/persist-message.consumer.integration.spec.ts; apps/ws-gateway/src/socket/handlers/chat.handler.spec.ts | Unauthorized mutation rejected at authoritative layer; member-allowed reaction behavior explicit and tested | Revert consumer authz checks and handler enforcement commit        |
| Remove wildcard CORS fallback + sync allow-list | Blocker  | bff-service, sso-service, interaction-service, ws-gateway, config | app-compose.yml; docker-compose.prod.yml; apps/bff-service/src/main.ts; apps/sso-service/src/main.ts; apps/interaction-service/src/main.ts; libs/config/src/app-config.ts                                    | libs/config/src/app-config.spec.ts; service bootstrap smoke tests                                                                                                                                      | No wildcard in prod path; HTTP/WS consume allow-list from shared config                                     | Restore previous compose defaults and service bootstrap CORS lines |
| Harden QR login socket trust model              | Blocker  | sso-service, ws-gateway                                           | apps/sso-service/src/modules/auth/auth.service.ts; apps/sso-service/src/modules/auth/dto/qr.dto.ts; apps/ws-gateway/src/transport/fanout/auth-fanout.consumer.ts; apps/ws-gateway/src/socket/chat.gateway.ts | apps/sso-service/src/modules/auth/auth.service.spec.ts; ws fanout consumer tests                                                                                                                       | QR confirm emits only to server-verified socket binding                                                     | Revert strict binding checks and fallback to prior emit behavior   |
| Standardize auth/authz error envelope           | High     | libs/interceptors, ws-gateway, bff-service, sso-service           | libs/interceptors/src/filters/global-exception.filter.ts; ws handlers/acks                                                                                                                                   | ws handler specs; HTTP filter specs                                                                                                                                                                    | WS/HTTP errors align on envelope schema with compatibility fields                                           | Revert envelope mapping and restore prior ack payload shape        |
| Atomic idempotency gate + immutable timestamp   | Blocker  | chat-service, scylla lib                                          | apps/chat-service/src/consumers/persist-message.consumer.ts; libs/scylla/src/repositories/message.repository.ts                                                                                              | persist-message consumer unit + integration tests                                                                                                                                                      | No duplicate logical row under retry/rebalance, timestamp mismatch handled                                  | Revert atomic operation and restore previous gate logic            |
| Seen-marker race closure                        | Blocker  | chat-service, interaction-service, contracts                      | consumer/repo/contracts touchpoints                                                                                                                                                                          | integration concurrency tests                                                                                                                                                                          | Seen marker idempotent under concurrent load                                                                | Revert seen-marker atomic path                                     |
| Moderation fail-safe + enforcement fanout       | Blocker  | ai-core-service, chat-service, ws-gateway, contracts              | apps/ai-core-service/src/modules/moderation/moderation.engine.ts; apps/ai-core-service/src/transport/ai.consumer.ts; ws fanout consumers; contracts                                                          | moderation engine specs; fanout specs; integration replay tests                                                                                                                                        | Provider failure follows fail-closed policy with single idempotent enforcement fanout                       | Revert enforcement emission path and policy flags                  |
| WS runtime validation + Kafka retry/DLQ path    | Blocker  | ws-gateway, kafka lib, contracts                                  | libs/contracts/src/ws/events.ts; libs/kafka/src/kafka.util.ts; ws handlers                                                                                                                                   | ws payload validation tests; poison-message handling tests                                                                                                                                             | Invalid WS payload rejected; poison messages follow retry/backoff/DLQ                                       | Revert validation middleware and retry/DLQ config                  |
| Hot-path performance + JWT cache/revocation     | High     | libs/auth, mvp-access, ws-gateway/chat-service                    | libs/auth/src/jwt-auth.guard.ts; libs/auth/src/jwt.service.ts; libs/mvp-access/src/membership.ts                                                                                                             | libs/auth/src/jwt.service.spec.ts; membership specs                                                                                                                                                    | Reduced DB-per-request with revocation-safe cache                                                           | Disable cache path and revert guard logic                          |
| Env hardening + release gate                    | Blocker  | config, workflows, compose                                        | libs/config/src/config.module.ts; .github/workflows/build.yml; docker-compose files                                                                                                                          | CI workflow checks + audit gate tests                                                                                                                                                                  | build/lint/test/audit/integration/codegen-drift gates all enforced                                          | Revert workflow gating commit and restore previous pipeline        |

## Gate Template (Apply to Every PR)

- Build: pnpm run build:all
- Lint: pnpm run lint
- Domain tests: targeted unit/integration specs for touched modules
- Contract change check: regenerate clients and verify no drift
- Rollback note: include service-level and config-level rollback steps

## Current Implementation Notes

- PR-02 has started with CORS hardening paths:
  - wildcard fallback removed from compose/runtime for covered services
  - shared config allow-list adopted for BFF/SSO/Interaction bootstraps
  - production safeguard added in config to reject missing/wildcard CORS origin
- PR-02 QR socket trust hardening is in progress:
  - added WS contract events for one-time QR socket binding token issuance
  - ws-gateway now issues one-time socketBindingToken and stores server-side binding in Redis
  - sso-service generate QR flow now requires socketBindingToken and rejects invalid/mismatched bindings
- PR-03 consistency hardening has started:
  - chat-service send consumer now reconciles pending idempotency state with replay claim semantics
  - duplicate/replay/timestamp-mismatch telemetry counters with structured log fields were added
  - seen-marker write path is now atomic (`IF NOT EXISTS`) and integration-tested for concurrent writes
  - interaction-service markAsRead now performs monotonic conditional update to prevent lastReadAt regression under concurrent requests
  - interaction-service tests now cover stale-update skip and non-member rejection under the new write path
- PR-04 AI safety/enforcement has started:
  - contracts-first update added `ai.moderation.enforcement` topic and corresponding Kafka/WS payload contracts
  - moderation engine is now explicitly fail-closed for provider and parsing failures (fail-open config ignored)
  - moderation result payload now carries decision source/failure metadata for downstream traceability
  - chat-service emits explicit moderation enforcement outcome events on delete enforcement path
  - ws-gateway now fans out moderation enforcement outcomes to conversation scope
