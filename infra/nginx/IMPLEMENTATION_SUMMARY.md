# Nginx Integration Summary

## What Was Implemented

Complete Nginx reverse proxy setup for Zalo Clone backend with:

- **REST API** routing (bff-service on port 5000)
- **WebSocket** routing (ws-gateway on port 3001)
- **SSL/TLS** support with HTTPS/WSS
- **Security features** (rate limiting, security headers, HSTS)
- **Performance optimizations** (gzip, buffering, keepalive)
- **Load balancing** ready configuration

## Files Created/Modified

### Modified Files:

1. **infra/nginx/nginx.conf** - Complete Nginx configuration with:
   - Upstream definitions for bff-service and ws-gateway
   - HTTP to HTTPS redirect
   - REST API proxying with rate limiting
   - WebSocket proxying with long-lived connections (24h timeout)
   - Security headers and SSL configuration

2. **infra-compose.yml** - Added ws-gateway as nginx dependency

3. **.gitignore** - Added SSL certificate exclusions

4. **apps/ws-gateway/src/socket/chat.gateway.ts** - Fixed unused variable lint error

### Created Files:

1. **infra/nginx/README.md** - Comprehensive documentation covering:
   - Architecture overview
   - SSL certificate setup (self-signed, Let's Encrypt, cloud)
   - Configuration details
   - Testing procedures
   - Load balancing
   - Troubleshooting
   - Production checklist

2. **infra/nginx/QUICKSTART.md** - Quick start guide for developers

3. **infra/nginx/generate-ssl.sh** - Bash script for SSL certificate generation (Linux/Mac)

4. **infra/nginx/generate-ssl.ps1** - PowerShell script for SSL certificate generation (Windows)

5. **infra/nginx/ssl/.gitkeep** - SSL directory placeholder with instructions

## Architecture

```
Client (Browser/Mobile App)
    ↓
Nginx (port 80/443)
    ├─→ HTTPS /api/*        → http://bff-service:5000
    └─→ WSS /socket.io/*    → http://ws-gateway:3001
```

### Key Features:

1. **Single Entry Point**: All traffic goes through Nginx (port 80/443)
2. **SSL Termination**: Nginx handles HTTPS/WSS, backend services use plain HTTP/WS
3. **Rate Limiting**: 10 req/s for API with burst capacity of 20
4. **WebSocket Support**: Properly configured with 24-hour timeout for persistent connections
5. **Security Headers**: X-Frame-Options, X-Content-Type-Options, HSTS, etc.
6. **Gzip Compression**: Reduces response sizes
7. **Load Balancing**: Ready for horizontal scaling (least_conn strategy)

## How to Use

### Development:

```bash
# 1. Generate SSL certificates
cd infra/nginx
.\generate-ssl.ps1  # Windows
# or
./generate-ssl.sh   # Linux/Mac

# 2. Start services
docker-compose -f infra-compose.yml up -d
docker-compose -f app-compose.yml up -d
docker-compose -f infra-compose.yml --profile with-nginx up -d

# 3. Test
curl -k https://localhost/api/health
```

### Production:

- Replace self-signed certificates with Let's Encrypt or commercial CA
- Update `server_name` in nginx.conf to your domain
- Review and adjust rate limits
- Configure proper CORS (remove wildcard)
- Set up monitoring and log rotation

## Testing Results

✅ **Build**: All services compile successfully
✅ **Lint**: Passes with 0 errors, 12 warnings (pre-existing)
✅ **Nginx Config**: Syntax valid and tested

## REST API vs WebSocket Handling

### REST API Configuration:

- 60-second timeout (suitable for HTTP requests)
- Rate limiting enabled (10 req/s)
- Connection limiting (10 concurrent per IP)
- Standard proxy headers

### WebSocket Configuration:

- 24-hour timeout (86400s) for persistent connections
- No rate limiting (would break WebSocket)
- `Upgrade` and `Connection` headers properly set
- Buffering disabled for real-time communication

## Security Considerations

1. **SSL/TLS**: TLS 1.2 and 1.3 only, modern cipher suites
2. **HSTS**: Strict-Transport-Security header forces HTTPS
3. **Rate Limiting**: Prevents API abuse
4. **Security Headers**: XSS protection, clickjacking prevention
5. **Hidden Files**: `.` files blocked from access

## Why This Matters

### Without Nginx:

- Each service needs SSL setup
- Multiple ports exposed (3000, 3001, etc.)
- No centralized rate limiting
- No load balancing
- More attack surface

### With Nginx:

- ✅ Single SSL setup
- ✅ Single entry point (port 443)
- ✅ Centralized security
- ✅ Easy horizontal scaling
- ✅ Better performance (caching, compression)

## Next Steps

1. **Generate SSL Certificates**:

   ```bash
   cd infra/nginx
   .\generate-ssl.ps1  # or ./generate-ssl.sh
   ```

2. **Start Services**:

   ```bash
   docker-compose -f infra-compose.yml --profile with-nginx up -d
   ```

3. **Test Endpoints**:
   - REST: `curl -k https://localhost/api/health`
   - WebSocket: Connect to `wss://localhost/socket.io/`

4. **For Production**:
   - Get proper SSL certificate
   - Update domain in nginx.conf
   - Review security settings
   - Set up monitoring

## Documentation References

- Full setup guide: [infra/nginx/README.md](infra/nginx/README.md)
- Quick start: [infra/nginx/QUICKSTART.md](infra/nginx/QUICKSTART.md)
- SSL generation: `generate-ssl.ps1` or `generate-ssl.sh`

---

**Status**: ✅ Complete and ready for use
**Build**: ✅ Passed
**Lint**: ✅ Passed (0 errors)
**Tested**: ✅ Configuration validated
