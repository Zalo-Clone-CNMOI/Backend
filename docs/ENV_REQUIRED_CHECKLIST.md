# Required ENV Checklist Per Service

Scope: required variables only (fail-fast at startup via config validation).

## ai-core-service

- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL
- ZAI_BOT_USER_ID (UUID; defaults to `00000000-0000-0000-0000-0000000000a1` in dev — set explicitly in prod to match the seeded Zai user)
- _Optional:_ ZAI_L2_MEMORY_ENABLED (default `false`), ZAI_L2_SUMMARY_TRIGGER_TURNS (default `30`) — Phase 6 L2 rolling-summary memory; leave off until telemetry warrants it.
- _Optional:_ ZAI_VISION_ENABLED (default `true`), ZAI_VISION_MAX_IMAGES (default `4`), ZAI_VISION_INLINE_BASE64 (default `false`) — Zai image vision; set `ZAI_VISION_INLINE_BASE64=true` in dev/LocalStack (router can't fetch local S3 URLs).

## bff-service

- CORS_ORIGIN
- JWT_SECRET
- JWT_REFRESH_SECRET
- REDIS_URL

## chat-service

- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL
- SCYLLA_CONTACT_POINTS
- SCYLLA_LOCAL_DATACENTER
- SCYLLA_KEYSPACE
- ZAI_BOT_USER_ID (UUID; trust-boundary value — `AiMessageConsumer` rejects any `chat.ai.message` whose `sender_id` does not match)

## interaction-service

- CORS_ORIGIN
- JWT_SECRET
- JWT_REFRESH_SECRET
- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL
- ZAI_BOT_USER_ID (UUID; used by `AiConversationFactoryService` to add Zai as a conversation member)

## media-service

- CORS_ORIGIN
- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID

## notification-service

- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL

## presence-service

- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL

## sso-service

- CORS_ORIGIN
- JWT_SECRET
- JWT_REFRESH_SECRET
- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- REDIS_URL

## ws-gateway

- CORS_ORIGIN
- JWT_SECRET
- JWT_REFRESH_SECRET
- KAFKA_BROKERS
- KAFKA_CLIENT_ID
- KAFKA_GROUP_ID
- REDIS_URL
- SCYLLA_CONTACT_POINTS
- SCYLLA_LOCAL_DATACENTER
- SCYLLA_KEYSPACE

## Notes

- SERVICE_NAME is set in each service bootstrap and does not need to be provided externally.
- For services requiring CORS_ORIGIN, wildcard (\*) is not allowed.
