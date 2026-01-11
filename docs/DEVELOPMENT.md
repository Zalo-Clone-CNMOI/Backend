# Development Guide

## Prerequisites

- Node.js + pnpm
- Docker Desktop

## Install

```bash
pnpm install
```

## Start local dependencies

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Initialize Scylla schema

Open a shell inside the scylla container:

```bash
docker exec -it backend-scylla-1 cqlsh
```

Then paste the contents of `infra/scylla/schema.cql`.

## Run services (separate terminals)

Copy `.env.example` to `.env` and adjust values.

- API:

```bash
pnpm run start:dev
```

- WS gateway:

```bash
pnpm run start:dev:ws
```

- Chat service (Kafka microservice):

```bash
pnpm run start:dev:chat
```

- Presence service (Kafka microservice):

```bash
pnpm run start:dev:presence
```

- Media service:

```bash
pnpm run start:dev:media
```

- Notification service:

```bash
pnpm run start:dev:notification
```

## Quick sanity checks

- `api-gateway`: `GET http://localhost:3000/health`
- `media-service`: `POST http://localhost:3003/v1/media/presign/upload`

Example presign request body:

```json
{ "contentType": "image/png", "fileName": "a.png" }
```

## Notes

- MVP conversation membership is hardcoded in `libs/mvp-access`.
- WS authentication expects `Authorization: Bearer <token>` (JWT secret from `.env`).
