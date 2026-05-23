FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/chat-service/package.json ./apps/chat-service/

RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/chat-service ./apps/chat-service

RUN pnpm run build:chat

FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/chat-service/package.json ./apps/chat-service/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

RUN chown -R nestjs:nodejs /app

USER nestjs

ENV NODE_ENV=production
ENV PORT=5002
ENV SERVICE_NAME=chat-service
ENV KAFKA_GROUP_ID=chat-service-persist

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5002/api/health || exit 1

CMD ["node", "dist/apps/chat-service/main.js"]
