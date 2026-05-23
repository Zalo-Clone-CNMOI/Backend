FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ws-gateway/package.json ./apps/ws-gateway/

RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/ws-gateway ./apps/ws-gateway

RUN pnpm run build:ws

FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ws-gateway/package.json ./apps/ws-gateway/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

RUN chown -R nestjs:nodejs /app

USER nestjs

ENV NODE_ENV=production
ENV PORT=3001
ENV SERVICE_NAME=ws-gateway
ENV KAFKA_GROUP_ID=ws-gateway-fanout

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "dist/apps/ws-gateway/main.js"]
