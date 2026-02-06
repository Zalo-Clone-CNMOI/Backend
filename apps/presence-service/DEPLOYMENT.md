# Presence Service Deployment

This document describes the deployment configuration and procedures for the presence service.

## Docker Configuration

### Dockerfile

Location: `apps/presence-service/Dockerfile`

**Multi-stage build:**
1. **dependencies** - Install production dependencies only
2. **build** - Compile TypeScript to JavaScript
3. **runtime** - Minimal runtime image

**Key Features:**
- Node.js 20 Alpine (minimal footprint)
- Non-root user (security)
- Health check via `/metrics` endpoint
- Production-optimized node_modules

### Docker Compose

Location: `app-compose.yml`

**Service Configuration:**
```yaml
presence-service:
  image: ghcr.io/zalo-clone/presence-service:latest
  container_name: zalo_presence_service
  ports:
    - "3002:3002"
  environment:
    KAFKA_BROKERS: kafka:29092
    REDIS_URL: redis://redis:6379
    PRESENCE_TTL_MS: 60000
    PRESENCE_CLEANUP_MS: 5000
  resources:
    limits:
      cpus: "0.3"
      memory: 256M
    reservations:
      cpus: "0.15"
      memory: 128M
```

**Resource Limits:**
- CPU: 0.3 cores max (300m in Kubernetes)
- Memory: 256MB max
- Reserved: 0.15 cores, 128MB

**Dependencies:**
- Kafka (event bus)
- Redis (state store)
- Zookeeper (Kafka coordination)

## CI/CD Pipeline

### GitHub Actions Workflow

Location: `.github/workflows/deploy.yml`

**Trigger Events:**
- Push to main branch
- Manual workflow dispatch
- Changes to presence-service or libs

**Pipeline Stages:**

1. **detect-changes**
   - Detects modified services
   - Outputs: `presence: true/false`

2. **lint-test**
   - Runs ESLint
   - Compiles all services
   - Requires: presence-service builds successfully

3. **build**
   - Builds Docker image
   - Pushes to GitHub Container Registry
   - Tags: `sha-<commit>`, `latest`
   - Multi-platform: linux/amd64

4. **deploy**
   - SSH to EC2 instance
   - Pull latest image
   - Deploy via docker-compose
   - Health check verification
   - Automatic rollback on failure

### Manual Deployment

**Deploy specific service:**
```bash
# Via GitHub UI
Actions → CI/CD Pipeline → Run workflow
  Service: presence
  
# Via GitHub CLI
gh workflow run deploy.yml -f service=presence
```

**Deploy all services:**
```bash
gh workflow run deploy.yml -f service=all
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `KAFKA_BROKERS` | Kafka broker addresses | `kafka:29092` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `KAFKA_CLIENT_ID` | Kafka client identifier | `presence-service` |
| `KAFKA_GROUP_ID` | Consumer group name | `presence-service-group` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PRESENCE_TTL_MS` | Socket TTL in milliseconds | `60000` (60s) |
| `PRESENCE_CLEANUP_MS` | Cleanup interval | `5000` (5s) |
| `PORT` | Service HTTP port | `3002` |
| `NODE_ENV` | Environment | `production` |

## Deployment Steps

### 1. Pre-deployment Checklist

- [ ] All tests passing locally
- [ ] Build successful: `pnpm run build:presence`
- [ ] Lint passing: `pnpm run lint`
- [ ] Environment variables configured
- [ ] Redis and Kafka accessible from EC2

### 2. Automatic Deployment (GitHub Actions)

```bash
# Commit changes
git add apps/presence-service
git commit -m "feat(presence): add production features"
git push origin main

# GitHub Actions automatically:
# 1. Detects changes to presence-service
# 2. Runs tests and linting
# 3. Builds Docker image
# 4. Pushes to ghcr.io
# 5. Deploys to EC2
# 6. Verifies health
```

### 3. Manual Deployment (SSH)

```bash
# SSH to EC2
ssh ec2-user@<EC2_HOST>

# Navigate to project
cd ~/Backend

# Login to GitHub Container Registry
echo $GH_TOKEN | docker login ghcr.io -u <username> --password-stdin

# Pull latest image
docker compose -f app-compose.yml pull presence-service

# Deploy
docker compose -f app-compose.yml up -d presence-service

# Verify
docker compose -f app-compose.yml ps presence-service
docker logs zalo_presence_service --tail 50

# Check health
curl http://localhost:3002/metrics
```

### 4. Rollback

**Automatic rollback (on health check failure):**
- Pipeline automatically reverts to previous image
- Previous container state restored

**Manual rollback:**
```bash
# SSH to EC2
cd ~/Backend

# Check rollback metadata
cat .rollback/presence-service.prev
# Output: ghcr.io/zalo-clone/presence-service:sha-abc123

# Pull previous image
docker pull ghcr.io/zalo-clone/presence-service:sha-abc123

# Tag as latest locally
docker tag ghcr.io/zalo-clone/presence-service:sha-abc123 \
           ghcr.io/zalo-clone/presence-service:latest

# Restart with previous version
docker compose -f app-compose.yml up -d presence-service

# Verify
docker logs zalo_presence_service --tail 50
curl http://localhost:3002/metrics
```

## Health Checks

### Docker Health Check

**Endpoint:** `GET /metrics`

**Criteria:**
- Status: 200 OK
- Response time: < 10s
- Interval: 30s
- Retries: 3
- Start period: 40s

**Status:**
```bash
docker inspect zalo_presence_service --format '{{.State.Health.Status}}'
# Output: healthy | unhealthy | starting
```

### Application Health

**Metrics endpoint:**
```bash
curl http://localhost:3002/metrics
```

**Key metrics to monitor:**
```promql
# Should be 0 (not degraded)
presence_is_degraded

# Should be > 0 if users connected
presence_active_users

# Should have low failure rate
rate(presence_connect_total{status="failure"}[5m])
```

## Monitoring

### Prometheus Integration

**Scrape configuration:**
```yaml
scrape_configs:
  - job_name: 'presence-service'
    static_configs:
      - targets: ['presence-service:3002']
    scrape_interval: 15s
```

**Access Prometheus:**
- Local: `http://localhost:9090`
- Production: Configure via infra-compose.yml

### Grafana Dashboards

**Import dashboard:**
1. Navigate to Grafana
2. Import dashboard JSON
3. Select Prometheus data source
4. Set refresh interval: 5s

**Key panels:**
- Active users (gauge)
- Connection rate (graph)
- Error rate (graph)
- Degraded mode status (alert)

### Alerting

**Critical alerts:**
- Degraded mode active
- High error rate (> 10/s)
- Service unhealthy

**Configure Alertmanager:**
```yaml
route:
  receiver: 'presence-alerts'
  routes:
    - match:
        service: presence
        severity: critical
      receiver: 'pagerduty'
```

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
docker logs zalo_presence_service --tail 100
```

**Common issues:**
1. **Kafka unavailable**
   ```
   Error: KafkaJSConnectionError
   ```
   **Solution:** Verify Kafka is running
   ```bash
   docker compose -f infra-compose.yml ps kafka
   ```

2. **Redis connection failed**
   ```
   Error: ECONNREFUSED redis:6379
   ```
   **Solution:** Verify Redis is running
   ```bash
   docker compose -f infra-compose.yml ps redis
   redis-cli ping
   ```

3. **Port already in use**
   ```
   Error: EADDRINUSE :::3002
   ```
   **Solution:** Stop conflicting service
   ```bash
   lsof -i :3002
   docker stop <container_id>
   ```

### Degraded Mode Activated

**Check Redis connection:**
```bash
# From presence service container
docker exec -it zalo_presence_service sh
wget -O- http://redis:6379 || echo "Redis unreachable"
```

**Verify Lua scripts loaded:**
```bash
# Check Redis
redis-cli SCRIPT EXISTS <sha1>
```

**Restart service:**
```bash
docker compose -f app-compose.yml restart presence-service
```

### High Memory Usage

**Check current usage:**
```bash
docker stats zalo_presence_service --no-stream
```

**Increase limits (if needed):**
```yaml
# app-compose.yml
resources:
  limits:
    memory: 512M  # Increased from 256M
```

**Restart with new limits:**
```bash
docker compose -f app-compose.yml up -d presence-service
```

## Performance Tuning

### Production Optimizations

**Redis connection pool:**
```env
REDIS_MAX_RETRIES_PER_REQUEST=3
REDIS_RETRY_STRATEGY=exponential
REDIS_ENABLE_OFFLINE_QUEUE=false
```

**Kafka consumer:**
```env
KAFKA_SESSION_TIMEOUT=30000
KAFKA_HEARTBEAT_INTERVAL=3000
KAFKA_MAX_IN_FLIGHT_REQUESTS=5
```

**Presence TTL tuning:**
```env
# Shorter TTL = more aggressive cleanup
PRESENCE_TTL_MS=45000

# More frequent cleanup = better accuracy
PRESENCE_CLEANUP_MS=3000
```

### Horizontal Scaling

**Run multiple replicas:**
```yaml
# app-compose.yml
presence-service:
  deploy:
    replicas: 3
```

**Load balancing:**
- Kafka automatically partitions events
- Each instance consumes from different partitions
- Redis handles concurrent access via Lua scripts

## Security

### Image Security

**Scan for vulnerabilities:**
```bash
docker scan ghcr.io/zalo-clone/presence-service:latest
```

**Update base image regularly:**
```dockerfile
FROM node:20-alpine  # Keep updated
```

### Network Security

**Container isolation:**
- Services communicate via internal Docker network
- Only expose necessary ports
- Use Docker secrets for sensitive data

**Environment secrets:**
```bash
# Use secrets instead of plain text
docker secret create redis_url redis://redis:6379
```

### Access Control

**GitHub Container Registry:**
- Requires authentication to pull images
- Use GitHub token with package read permissions
- Rotate tokens regularly

## Maintenance

### Regular Tasks

**Weekly:**
- Review error logs
- Check metrics dashboards
- Verify alert rules

**Monthly:**
- Update dependencies
- Review resource usage
- Load testing

**Quarterly:**
- Security audit
- Performance review
- Disaster recovery drill

### Backup & Recovery

**Redis backup:**
```bash
# Backup Redis data
docker exec zalo_redis redis-cli BGSAVE
docker cp zalo_redis:/data/dump.rdb ./backup/
```

**Service configuration:**
```bash
# Backup compose files
tar -czf backup-$(date +%Y%m%d).tar.gz \
  app-compose.yml \
  infra-compose.yml \
  .env.prod
```

## References

- [PRESENCE_SERVICE.md](../docs/PRESENCE_SERVICE.md) - Architecture & flows
- [METRICS.md](./METRICS.md) - Metrics documentation
- [VPS_DEPLOY_GUIDE.md](../docs/VPS_DEPLOY_GUIDE.md) - General deployment guide
- [GitHub Actions Docs](https://docs.github.com/en/actions)
