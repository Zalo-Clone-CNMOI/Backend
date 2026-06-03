import { Injectable, Logger } from '@nestjs/common';
import { ConversationType } from '@app/constant';
import { MembershipClientService } from '@app/clients/membership-client';
import { CacheService } from '@libs/redis';

interface MembershipCacheEntry {
  allowed: boolean;
  conversationType: ConversationType | null;
  expiresAt: number;
}

interface SendPermCacheEntry {
  allowed: boolean;
  reason?: string;
  expiresAt: number;
}

interface PendingMembershipBatch {
  conversationIds: Set<string>;
  waiters: Map<
    string,
    Array<{
      resolve: (allowed: boolean) => void;
      reject: (error: unknown) => void;
    }>
  >;
  scheduled: boolean;
}

/**
 * ws-gateway-local membership facade.
 *
 * Drop-in replacement for the former in-process ConversationMembershipService +
 * FriendshipAccessService (which required a TypeORM DataSource). ws-gateway is
 * now stateless: every cache MISS is answered by interaction-service over HTTP
 * via MembershipClientService instead of querying Postgres directly.
 *
 * The short-TTL caches and request batching are kept here verbatim so the
 * real-time hot path stays fast and behaves exactly as before:
 *   - accessCache:   2s  — membership + conversation type (co-located)
 *   - sendPermCache: 5s  — send-permission decision (role-sensitive)
 *   - request batching: many canUserAccessConversation() calls in one tick
 *     collapse into a single getMembershipBatch() HTTP call.
 * Cache-invalidation methods stay purely local (no HTTP) — they are driven by
 * Kafka fanout events the gateway already consumes.
 */
@Injectable()
export class WsMembershipService {
  private readonly ACCESS_CACHE_TTL_MS = 2000;
  private readonly SEND_PERM_CACHE_TTL_MS = 5000;
  private readonly FRIEND_PAIR_TTL_S = 120;
  private readonly logger = new Logger(WsMembershipService.name);

  private readonly accessCache = new Map<string, MembershipCacheEntry>();
  private readonly sendPermCache = new Map<string, SendPermCacheEntry>();
  private readonly pendingBatches = new Map<string, PendingMembershipBatch>();

  constructor(
    private readonly membershipClient: MembershipClientService,
    private readonly cacheService: CacheService,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.accessCache) {
        if (entry.expiresAt <= now) this.accessCache.delete(key);
      }
      for (const [key, entry] of this.sendPermCache) {
        if (entry.expiresAt <= now) this.sendPermCache.delete(key);
      }
    }, 10_000).unref();
  }

  async canUserAccessConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const cacheKey = this.getAccessCacheKey(userId, conversationId);
    const cached = this.accessCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed;
    }
    return this.queueMembershipCheck(userId, conversationId);
  }

  async canUserAccessConversations(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, boolean>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const deduped = Array.from(new Set(conversationIds));
    const result = new Map<string, boolean>();
    const missing: string[] = [];

    for (const conversationId of deduped) {
      const cacheKey = this.getAccessCacheKey(userId, conversationId);
      const cached = this.accessCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        result.set(conversationId, cached.allowed);
      } else {
        missing.push(conversationId);
      }
    }

    if (missing.length > 0) {
      const entries = await this.membershipClient.getMembershipBatch(
        userId,
        missing,
      );
      const now = Date.now();
      for (const entry of entries) {
        result.set(entry.conversation_id, entry.allowed);
        this.accessCache.set(
          this.getAccessCacheKey(userId, entry.conversation_id),
          {
            allowed: entry.allowed,
            conversationType: entry.conversation_type,
            expiresAt: now + this.ACCESS_CACHE_TTL_MS,
          },
        );
      }
    }

    return new Map(
      conversationIds.map((conversationId) => [
        conversationId,
        result.get(conversationId) ?? false,
      ]),
    );
  }

  /**
   * Conversation type co-cached with the membership check. Null = no access or
   * conversation does not exist. Triggers the batch path on a miss.
   */
  async getCachedConversationType(
    userId: string,
    conversationId: string,
  ): Promise<ConversationType | null> {
    const cacheKey = this.getAccessCacheKey(userId, conversationId);
    const cached = this.accessCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.conversationType;
    }
    await this.queueMembershipCheck(userId, conversationId);
    return this.accessCache.get(cacheKey)?.conversationType ?? null;
  }

  /**
   * Send-permission decision. The server folds the old settings(30s) + role(5s)
   * tiers into one response; we cache the final {allowed, reason} for 5s keyed
   * by user+conversation (the shorter of the two original TTLs, so role/setting
   * changes surface within the same window as before).
   */
  async canUserSendMessage(
    userId: string,
    conversationId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const cacheKey = `${userId}:${conversationId}`;
    const cached = this.sendPermCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { allowed: cached.allowed, reason: cached.reason };
    }

    const decision = await this.membershipClient.getSendPermission(
      userId,
      conversationId,
    );
    this.sendPermCache.set(cacheKey, {
      allowed: decision.allowed,
      reason: decision.reason,
      expiresAt: Date.now() + this.SEND_PERM_CACHE_TTL_MS,
    });
    return decision;
  }

  /**
   * Active member IDs of a conversation. Uncached to match the original
   * ConversationMembershipService.listActiveMemberIds behavior exactly.
   */
  async listActiveMemberIds(conversationId: string): Promise<string[]> {
    return this.membershipClient.listActiveMemberIds(conversationId);
  }

  /**
   * Of candidateIds, those that are friends with referenceUserId. Preserves the
   * 120s Redis pair-cache from the former FriendshipAccessService; only the
   * uncached remainder hits interaction-service. The reference user is treated
   * as its own friend (self-inclusion), matching prior behavior.
   */
  async getFriendSet(
    referenceUserId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (!candidateIds.length) return new Set();

    const result = new Set<string>();
    const uncached: string[] = [];

    for (const id of candidateIds) {
      if (id === referenceUserId) {
        result.add(id);
        continue;
      }
      const key = this.pairKey(referenceUserId, id);
      const cached = await this.cacheService.get<boolean>(key);
      if (cached === true) result.add(id);
      else if (cached === null) uncached.push(id);
    }

    if (uncached.length === 0) return result;

    const friendIds = await this.membershipClient.getFriendSet(
      referenceUserId,
      uncached,
    );
    const friendSet = new Set(friendIds);

    const cacheWrites: Array<Promise<unknown>> = [];
    for (const id of uncached) {
      const isFriend = friendSet.has(id);
      cacheWrites.push(
        this.cacheService.set(
          this.pairKey(referenceUserId, id),
          isFriend,
          this.FRIEND_PAIR_TTL_S,
        ),
      );
      if (isFriend) result.add(id);
    }
    await Promise.all(cacheWrites);

    return result;
  }

  // ── Local cache invalidation (no HTTP) — driven by Kafka fanout ──────────

  invalidateSettingsCache(conversationId: string): void {
    const suffix = `:${conversationId}`;
    for (const key of Array.from(this.sendPermCache.keys())) {
      if (key.endsWith(suffix)) this.sendPermCache.delete(key);
    }
  }

  invalidateRoleCache(userId: string, conversationId: string): void {
    this.sendPermCache.delete(`${userId}:${conversationId}`);
  }

  invalidate(userId: string, conversationId: string): void {
    this.accessCache.delete(this.getAccessCacheKey(userId, conversationId));
  }

  // ── Internals (ported from ConversationMembershipService) ────────────────

  private queueMembershipCheck(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let pending = this.pendingBatches.get(userId);
      if (!pending) {
        pending = {
          conversationIds: new Set<string>(),
          waiters: new Map(),
          scheduled: false,
        };
        this.pendingBatches.set(userId, pending);
      }

      pending.conversationIds.add(conversationId);
      const existingWaiters = pending.waiters.get(conversationId) ?? [];
      existingWaiters.push({ resolve, reject });
      pending.waiters.set(conversationId, existingWaiters);

      if (!pending.scheduled) {
        pending.scheduled = true;
        setImmediate(() => {
          void this.flushBatch(userId);
        });
      }
    });
  }

  private async flushBatch(userId: string): Promise<void> {
    const pending = this.pendingBatches.get(userId);
    if (!pending) return;

    this.pendingBatches.delete(userId);
    const conversationIds = Array.from(pending.conversationIds);

    try {
      const result = await this.canUserAccessConversations(
        userId,
        conversationIds,
      );
      for (const conversationId of conversationIds) {
        const allowed = result.get(conversationId) ?? false;
        const waiters = pending.waiters.get(conversationId) ?? [];
        for (const waiter of waiters) {
          waiter.resolve(allowed);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Membership batch check failed for user ${userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      for (const conversationId of conversationIds) {
        const waiters = pending.waiters.get(conversationId) ?? [];
        for (const waiter of waiters) {
          waiter.reject(error);
        }
      }
    }
  }

  private getAccessCacheKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  private pairKey(a: string, b: string): string {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `friendship:pair:${lo}:${hi}`;
  }
}
