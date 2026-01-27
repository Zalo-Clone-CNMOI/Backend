# Development Guide

## Prerequisites

- **Node.js** (v18+) + **pnpm** (v8+)
- **Docker Desktop** (for local infrastructure)
- **Git**

## Quick Start

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd Backend
pnpm install
```

### 2. Environment Configuration

Copy environment files for each service:

```bash
# BFF Service (main API gateway)
cp apps/bff-service/.env.example apps/bff-service/.env

# SSO Service (auth & users)
cp apps/sso-service/.env.example apps/sso-service/.env

# Interaction Service (friends & conversations)
cp apps/interaction-service/.env.example apps/interaction-service/.env
```

**Key environment variables to configure:**

```env
# Database
DB_HOST=localhost
DB_PORT=5439
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=zaloclone

# ScyllaDB
SCYLLA_CONTACT_POINTS=localhost:9042
SCYLLA_LOCAL_DATA_CENTER=datacenter1
SCYLLA_KEYSPACE=chat

# Kafka
KAFKA_BROKERS=localhost:9092

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN=7d

# S3 (LocalStack)
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
S3_BUCKET_NAME=zalo-clone-media

# Firebase (for phone authentication)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

### 3. Start Infrastructure Services

Start all required infrastructure using Docker Compose:

```bash
docker compose up -d
```

**Services started:**

- **PostgreSQL** (`:5439`) - User data, relationships, conversations
- **ScyllaDB** (`:9042`) - Message storage
- **Kafka + Zookeeper** (`:9092`, `:2181`) - Event streaming
- **Redis** (`:6379`) - Caching & Socket.IO adapter
- **LocalStack S3** (`:4566`) - File storage

**Verify infrastructure:**

```bash
# Check all containers are running
docker compose ps

# Expected output: All services should show "Up"
```

### 4. Initialize Databases

#### PostgreSQL (TypeORM Migrations)

```bash
# Run migrations to create tables
pnpm run migration:up

# Check migration status
pnpm run migration:show
```

#### ScyllaDB Schema

Option 1 - Automated script:

```bash
pnpm run scylla:init
```

Option 2 - Manual:

```bash
# Copy schema file into container
docker cp infra/scylla/schema.cql zalo-clone-scylla-1:/tmp/schema.cql

# Execute schema
docker exec -it zalo-clone-scylla-1 cqlsh -f /tmp/schema.cql
```

**Verify ScyllaDB schema:**

```bash
pnpm run scylla:status
# or manually:
docker exec -it zalo-clone-scylla-1 cqlsh -e "DESCRIBE KEYSPACE chat;"
```

### 5. Run Services (Development Mode)

Start services in **separate terminals** (or use tmux/screen):

#### Terminal 1: BFF Service (Main API)

```bash
pnpm run start:dev:bff
# Runs on http://localhost:3000
# Swagger docs: http://localhost:3000/docs
```

#### Terminal 2: SSO Service (Auth & Users)

```bash
pnpm run start:dev:sso
# Runs on http://localhost:5001
# Swagger docs: http://localhost:5001/docs
```

#### Terminal 3: Interaction Service (Friends & Conversations)

```bash
pnpm run start:dev:interaction
# Runs on http://localhost:5004
# Swagger docs: http://localhost:5004/docs
```

#### Terminal 4: WS Gateway (WebSocket)

```bash
pnpm run start:dev:ws
# Runs on http://localhost:3001
# WebSocket endpoint: ws://localhost:3001
```

#### Terminal 5: Chat Service (Message Persistence)

```bash
pnpm run start:dev:chat
# Runs on http://localhost:5002
# HTTP API + Kafka consumer
```

#### Terminal 6: Presence Service (User Status)

```bash
pnpm run start:dev:presence
# Kafka consumer only (no HTTP)
```

#### Terminal 7: Media Service (File Upload)

```bash
pnpm run start:dev:media
# Runs on http://localhost:3003
```

#### Terminal 8: Notification Service (Push Notifications)

```bash
pnpm run start:dev:notification
# Kafka consumer only (no HTTP)
```

**Service Startup Order** (recommended):

1. Infrastructure services (Docker)
2. Database migrations
3. BFF, SSO, Interaction services (HTTP APIs)
4. WS Gateway, Chat service
5. Presence, Media, Notification services

## API Testing

### Health Checks

```bash
# BFF Service
curl http://localhost:3000/api/health

# SSO Service
curl http://localhost:5001/api/health

# Interaction Service
curl http://localhost:5004/api/health

# Chat Service
curl http://localhost:5002/api/health

# Media Service
curl http://localhost:3003/health
```

### Example API Requests

#### 1. Register User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+84901234567",
    "password": "SecurePass123!",
    "displayName": "John Doe",
    "firebaseToken": "firebase-id-token-from-client"
  }'
```

#### 2. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+84901234567",
    "password": "SecurePass123!"
  }'
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh-token-here",
  "user": {
    "userId": "uuid",
    "phone": "+84901234567",
    "displayName": "John Doe"
  }
}
```

#### 3. Get User Profile

```bash
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <access-token>"
```

#### 4. Send Friend Request

```bash
curl -X POST http://localhost:3000/api/friends/requests \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "receiverId": "friend-user-id"
  }'
```

#### 5. Create Direct Conversation

```bash
curl -X POST http://localhost:3000/api/conversations/direct \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "participantId": "friend-user-id"
  }'
```

#### 6. Get Messages

```bash
curl "http://localhost:3000/api/messages/{conversationId}?limit=50" \
  -H "Authorization: Bearer <access-token>"
```

### WebSocket Connection (Socket.IO)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-access-token',
  },
});

// Join conversation
socket.emit('chat:join', { conversation_id: 'conv-uuid' });

// Send message
socket.emit('chat:send', {
  message_id: 'msg-uuid',
  conversation_id: 'conv-uuid',
  body: 'Hello!',
  sent_at: Date.now(),
});

// Listen for messages
socket.on('chat:message', (message) => {
  console.log('New message:', message);
});

// Send presence heartbeat
setInterval(() => {
  socket.emit('presence:heartbeat', {});
}, 30000);
```

## Build & Production

### Build All Services

```bash
pnpm run build:all
```

### Build Individual Services

```bash
pnpm run build:bff         # BFF service
pnpm run build:sso         # SSO service
pnpm run build:interaction # Interaction service
pnpm run build:ws          # WS Gateway
pnpm run build:chat        # Chat service
pnpm run build:presence    # Presence service
pnpm run build:media       # Media service
pnpm run build:notification # Notification service
```

### Production Deployment

See [VPS_DEPLOY_GUIDE.md](VPS_DEPLOY_GUIDE.md) for production deployment instructions.

## Database Management

### PostgreSQL Migrations

```bash
# Generate new migration
pnpm run migration:generate --name=add_user_status

# Run pending migrations
pnpm run migration:up

# Revert last migration
pnpm run migration:revert

# Show migration status
pnpm run migration:show
```

### ScyllaDB Management

```bash
# Initialize schema (first time)
pnpm run scylla:init

# Reset database (WARNING: deletes all data)
pnpm run scylla:reset

# Check schema status
pnpm run scylla:status

# Interactive CQL shell
docker exec -it zalo-clone-scylla-1 cqlsh
```

**Useful CQL queries:**

```sql
-- View all messages in a conversation
SELECT * FROM chat.messages_by_conversation
WHERE conversation_id = 'conv-uuid'
LIMIT 20;

-- Check message count
SELECT COUNT(*) FROM chat.messages_by_conversation
WHERE conversation_id = 'conv-uuid';

-- View reactions
SELECT * FROM chat.reactions_by_message
WHERE message_id = 'msg-uuid';
```

## Code Generation

### OpenAPI Client Generation

Generate TypeScript clients from OpenAPI specs:

```bash
# Generate SSO client
pnpm run codegen:sso

# Generate Interaction client
pnpm run codegen:interaction

# Generate Chat client
pnpm run codegen:chat

# Generate all
pnpm run codegen:sso && pnpm run codegen:interaction && pnpm run codegen:chat
```

Generated clients are located in:

- `libs/clients/src/sso-client/src/client/generated/`
- `libs/clients/src/interaction-client/src/client/generated/`
- `libs/clients/src/chat-client/src/client/generated/`

## Debugging

### View Logs

```bash
# Docker container logs
docker compose logs -f kafka
docker compose logs -f scylla
docker compose logs -f redis
docker compose logs -f db

# Application logs (check terminal outputs)
```

### Kafka Debugging

```bash
# List topics
docker exec -it zalo-clone-kafka-1 kafka-topics --list \
  --bootstrap-server localhost:9092

# Consume messages from topic
docker exec -it zalo-clone-kafka-1 kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic chat.message.send \
  --from-beginning

# Check consumer groups
docker exec -it zalo-clone-kafka-1 kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --list
```

### Redis Debugging

```bash
# Redis CLI
docker exec -it zalo-clone-redis-1 redis-cli

# Check presence keys
docker exec -it zalo-clone-redis-1 redis-cli KEYS "presence:*"

# Monitor commands
docker exec -it zalo-clone-redis-1 redis-cli MONITOR
```

## Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:cov

# Run E2E tests
pnpm test:e2e
```

## Code Quality

```bash
# Lint code
pnpm run lint

# Format code
pnpm run format
```

## Common Issues & Solutions

### Issue: ScyllaDB connection refused

**Solution:**

```bash
# Wait for ScyllaDB to fully start (can take 30-60 seconds)
docker logs zalo-clone-scylla-1 --follow

# Look for "Starting listening for CQL clients"
```

### Issue: Kafka consumer not receiving messages

**Solution:**

```bash
# Check Kafka is running
docker compose ps kafka

# Verify topic exists
docker exec -it zalo-clone-kafka-1 kafka-topics --list \
  --bootstrap-server localhost:9092

# Check consumer group lag
docker exec -it zalo-clone-kafka-1 kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe --group ws-gateway-fanout
```

### Issue: PostgreSQL migrations fail

**Solution:**

```bash
# Ensure database is ready
docker compose ps db

# Build all services first
pnpm run build:all

# Then run migrations
pnpm run migration:up
```

### Issue: WebSocket authentication fails

**Solution:**

- Verify `JWT_SECRET` matches across BFF, SSO, and WS Gateway services
- Ensure JWT token is sent in handshake: `auth.token` or `Authorization` header
- Check token expiration

### Issue: Port already in use

**Solution:**

```bash
# Find process using port (example: 3000)
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -i :3000
kill -9 <PID>
```

## Development Tips

1. **Use Swagger UI** - Each HTTP service exposes `/docs` endpoint for API testing
2. **Monitor Kafka** - Use [Kafka UI](https://github.com/provectus/kafka-ui) for topic visualization
3. **Redis Desktop Manager** - Use [RedisInsight](https://redis.io/insight/) for Redis debugging
4. **ScyllaDB Monitoring** - Access Scylla metrics at `http://localhost:9042`
5. **Hot Reload** - All services use `--watch` flag for automatic restarts
6. **Postman Collection** - Import API endpoints from Swagger JSON for testing

## Architecture Notes

- **BFF Pattern**: BFF service aggregates calls to SSO, Interaction, and Chat services
- **Event-Driven**: Real-time events flow through Kafka for decoupling
- **Dual Database**: PostgreSQL for relational data, ScyllaDB for high-throughput messages
- **OpenAPI Code Generation**: Type-safe HTTP clients auto-generated from Swagger specs
- **JWT Authentication**: Stateless auth with refresh token rotation
- **Socket.IO Scaling**: Redis adapter enables horizontal scaling of WebSocket servers
- **MVP Access Control**: Temporary hardcoded membership in `@libs/mvp-access` (will be replaced)

## Next Steps

1. Set up Firebase project for phone authentication
2. Configure production database credentials
3. Set up monitoring (Prometheus + Grafana)
4. Configure CI/CD pipeline
5. Set up log aggregation (ELK Stack or Loki)
6. Review [VPS_DEPLOY_GUIDE.md](VPS_DEPLOY_GUIDE.md) for production deployment
