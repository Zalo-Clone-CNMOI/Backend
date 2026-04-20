import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { ConversationMember } from '@libs/database/entities';

interface MembershipCacheEntry {
  allowed: boolean;
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

@Injectable()
export class ConversationMembershipService {
  private readonly ACCESS_CACHE_TTL_MS = 2000;
  private readonly logger = new Logger(ConversationMembershipService.name);
  private readonly accessCache = new Map<string, MembershipCacheEntry>();
  private readonly pendingBatches = new Map<string, PendingMembershipBatch>();

  constructor(
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.accessCache) {
        if (entry.expiresAt <= now) {
          this.accessCache.delete(key);
        }
      }
    }, 10_000).unref();
  }

  /**
   * Check if a user has access to a conversation
   * User has access if they are an active member (leftAt is null)
   */
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

  /**
   * List all conversations for a user
   * Returns only active memberships (leftAt is null)
   */
  async listConversationsForUser(userId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: {
        userId,
        leftAt: IsNull(),
      },
      select: ['conversationId'],
    });

    return memberships.map((m) => m.conversationId);
  }

  async listActiveMemberIds(conversationId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: {
        conversationId,
        leftAt: IsNull(),
      },
      select: ['userId'],
    });

    return memberships.map((m) => m.userId);
  }

  /**
   * Batch check user access for multiple conversations
   * More efficient than calling canUserAccessConversation multiple times
   */
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
      const queryResult = await this.queryAccessMap(userId, missing);
      for (const [conversationId, allowed] of queryResult.entries()) {
        result.set(conversationId, allowed);
        this.accessCache.set(this.getAccessCacheKey(userId, conversationId), {
          allowed,
          expiresAt: Date.now() + this.ACCESS_CACHE_TTL_MS,
        });
      }
    }

    return new Map(
      conversationIds.map((conversationId) => [
        conversationId,
        result.get(conversationId) ?? false,
      ]),
    );
  }

  private async queryAccessMap(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, boolean>> {
    const memberships = await this.memberRepository.find({
      where: {
        userId,
        conversationId: In(conversationIds),
        leftAt: IsNull(),
      },
      select: ['conversationId'],
    });

    const accessibleConversations = new Set(
      memberships.map((m) => m.conversationId),
    );

    return new Map(
      conversationIds.map((id) => [id, accessibleConversations.has(id)]),
    );
  }

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
    if (!pending) {
      return;
    }

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
}

const logger = new Logger('ConversationMembershipServiceLegacy');

export function canUserAccessConversation(): boolean {
  logger.warn(
    'DEPRECATED: canUserAccessConversation() function uses hardcoded data. ' +
      'Use ConversationMembershipService.canUserAccessConversation() instead.',
  );
  return false;
}

export function listConversationsForUser(): string[] {
  logger.warn(
    'DEPRECATED: listConversationsForUser() function uses hardcoded data. ' +
      'Use ConversationMembershipService.listConversationsForUser() instead.',
  );
  return [];
}
