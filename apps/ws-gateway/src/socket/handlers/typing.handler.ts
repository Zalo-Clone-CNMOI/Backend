import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import {
  WsEvents,
  type WsChatTypingPayload,
  type WsChatTypingUpdatePayload,
  type WsChatTypingUser,
} from '@libs/contracts';
import type { Server, Socket } from 'socket.io';

type SocketData = { userId?: string };
type AuthedSocket = Socket<any, any, any, SocketData>;

@Injectable()
export class TypingHandler implements OnModuleDestroy {
  private readonly logger = new Logger(TypingHandler.name);
  private server!: Server;

  private readonly REDIS_KEY_PREFIX = 'typing:';
  private readonly TYPING_TTL_SECONDS = 3;
  private readonly TYPING_TTL_MS = 3000;
  private readonly THROTTLE_MS = 1000;
  private readonly RECHECK_DELAY_MS = 3500;

  /** Server-side throttle: last processed timestamp per userId:conversationId */
  private readonly lastEventMap = new Map<string, number>();
  /** Outgoing dedup: last broadcast JSON per conversationId */
  private readonly lastBroadcastMap = new Map<string, string>();
  /** Cleanup timers per conversationId */
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }
  async handleTyping(
    socket: AuthedSocket,
    body: WsChatTypingPayload,
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId || !body?.conversation_id || !body?.username) return;

    const convId = body.conversation_id;
    const throttleKey = `${userId}:${convId}`;

    // ── Server-side throttle ──────────────────────────────────────────
    const now = Date.now();
    const lastEvent = this.lastEventMap.get(throttleKey);
    if (lastEvent && now - lastEvent < this.THROTTLE_MS) return;
    this.lastEventMap.set(throttleKey, now);

    // ── Membership check ────────────────────────────────────────────
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      convId,
    );
    if (!canAccess) return;

    // ── Write to Redis hash ───────────────────────────────────────────
    const redisKey = `${this.REDIS_KEY_PREFIX}${convId}`;
    const value = JSON.stringify({
      username: body.username ?? '',
      expires_at: now + this.TYPING_TTL_MS,
    });

    try {
      await this.redis.hSet(redisKey, userId, value);
      await this.redis.expire(redisKey, this.TYPING_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Redis error in handleTyping: ${error}`);
      return;
    }

    // ── Broadcast current typing list ─────────────────────────────────
    await this.broadcastTypingList(convId);

    // ── Schedule cleanup re-check ─────────────────────────────────────
    this.scheduleCleanup(convId);
  }

  async clearTyping(userId: string, conversationId: string): Promise<void> {
    const redisKey = `${this.REDIS_KEY_PREFIX}${conversationId}`;

    try {
      await this.redis.hDel(redisKey, userId);
    } catch (error) {
      this.logger.error(`Redis error in clearTyping: ${error}`);
    }

    this.lastEventMap.delete(`${userId}:${conversationId}`);
    await this.broadcastTypingList(conversationId);
  }

  onModuleDestroy(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.lastEventMap.clear();
    this.lastBroadcastMap.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private async broadcastTypingList(conversationId: string): Promise<void> {
    const redisKey = `${this.REDIS_KEY_PREFIX}${conversationId}`;
    let raw: Record<string, string>;

    try {
      raw = await this.redis.hGetAll(redisKey);
    } catch (error) {
      this.logger.error(`Redis error in broadcastTypingList: ${error}`);
      return;
    }

    const now = Date.now();
    const activeUsers: WsChatTypingUser[] = [];
    const expired: string[] = [];

    for (const [userId, json] of Object.entries(raw)) {
      try {
        const { username, expires_at } = JSON.parse(json) as {
          username: string;
          expires_at: number;
        };
        if (expires_at > now) {
          activeUsers.push({ user_id: userId, username });
        } else {
          expired.push(userId);
        }
      } catch {
        expired.push(userId);
      }
    }

    // Clean up expired fields (fire-and-forget)
    if (expired.length > 0) {
      void this.redis.hDel(redisKey, expired).catch(() => {});
    }

    // ── Outgoing dedup ────────────────────────────────────────────────
    activeUsers.sort((a, b) => a.user_id.localeCompare(b.user_id));
    const snapshot = JSON.stringify(activeUsers);
    if (this.lastBroadcastMap.get(conversationId) === snapshot) return;
    this.lastBroadcastMap.set(conversationId, snapshot);

    // Clean up dedup map when conversation has no typers
    if (activeUsers.length === 0) {
      this.lastBroadcastMap.delete(conversationId);
    }

    // ── Broadcast ─────────────────────────────────────────────────────
    const payload: WsChatTypingUpdatePayload = {
      conversation_id: conversationId,
      users: activeUsers,
    };
    this.server
      .to(`conv:${conversationId}`)
      .emit(WsEvents.ChatTypingUpdate, payload);
  }

  private scheduleCleanup(conversationId: string): void {
    const existing = this.pendingTimers.get(conversationId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingTimers.delete(conversationId);
      void this.broadcastTypingList(conversationId);
    }, this.RECHECK_DELAY_MS);

    this.pendingTimers.set(conversationId, timer);
  }
}
