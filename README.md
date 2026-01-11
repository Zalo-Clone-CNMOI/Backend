# BE Real-time Chat (Zalo clone) — Monorepo

This backend is a NestJS monorepo scaffold for a large-scale, real-time messaging platform.

## Structure

- `apps/api-gateway`: HTTP edge (REST)
- `apps/ws-gateway`: Socket.IO edge + Kafka fanout
- `apps/chat-service`: Kafka microservice + ScyllaDB persistence
- `apps/presence-service`: Kafka microservice + presence TTL
- `apps/media-service`: HTTP + S3 presigned uploads
- `apps/notification-service`: Kafka microservice + mock notification provider

Shared libraries live under `libs/*` (contracts, kafka, scylla, auth, config, logger, mvp-access).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Quickstart

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
```

Then follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to initialize Scylla schema and run services.
