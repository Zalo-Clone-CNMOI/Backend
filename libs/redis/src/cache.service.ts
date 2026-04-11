import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from './redis.tokens';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  // User cache prefixes
  private readonly USER_PROFILE_PREFIX = 'cache:user:profile:';
  private readonly USER_PUBLIC_PREFIX = 'cache:user:public:';

  // Conversation cache prefixes
  private readonly CONVERSATION_LIST_PREFIX = 'cache:conversation:list:';
  private readonly CONVERSATION_DETAIL_PREFIX = 'cache:conversation:detail:';

  // Friend cache prefixes
  private readonly FRIEND_LIST_PREFIX = 'cache:friend:list:';

  // Message cache prefixes
  private readonly MESSAGES_RECENT_PREFIX = 'cache:messages:recent:';

  // TTLs (in seconds)
  private readonly USER_PROFILE_TTL = 1800; // 30 minutes
  private readonly USER_PUBLIC_TTL = 900; // 15 minutes
  private readonly CONVERSATION_LIST_TTL = 300; // 5 minutes
  private readonly CONVERSATION_DETAIL_TTL = 600; // 10 minutes
  private readonly FRIEND_LIST_TTL = 600; // 10 minutes
  private readonly MESSAGES_RECENT_TTL = 300; // 5 minutes

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: RedisClientType,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redisClient.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.redisClient.setEx(key, ttl, serialized);
      this.logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  async setIfAbsent(key: string, value: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redisClient.set(key, value, {
        NX: true,
        EX: ttl,
      });
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Cache setIfAbsent error for key ${key}:`, error);
      throw error;
    }
  }

  async delIfValueMatches(
    key: string,
    expectedValue: string,
  ): Promise<boolean> {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

    try {
      const result = await this.redisClient.eval(script, {
        keys: [key],
        arguments: [expectedValue],
      });

      return Number(result) === 1;
    } catch (error) {
      this.logger.error(`Cache delIfValueMatches error for key ${key}:`, error);
      return false;
    }
  }

  async expireIfValueMatches(
    key: string,
    expectedValue: string,
    ttl: number,
  ): Promise<'renewed' | 'mismatch' | 'error'> {
    const script =
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end";

    try {
      const result = await this.redisClient.eval(script, {
        keys: [key],
        arguments: [expectedValue, String(ttl)],
      });

      return Number(result) === 1 ? 'renewed' : 'mismatch';
    } catch (error) {
      this.logger.error(
        `Cache expireIfValueMatches error for key ${key}:`,
        error,
      );
      return 'error';
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      if (keys.length === 0) return;
      await this.redisClient.del(keys);
      this.logger.debug(`Cache deleted: ${keys.join(', ')}`);
    } catch (error) {
      this.logger.error(`Cache delete error:`, error);
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    try {
      const keys: string[] = [];
      for await (const key of this.redisClient.scanIterator({
        MATCH: pattern,
        COUNT: 100,
      })) {
        keys.push(key);
      }

      if (keys.length === 0) {
        this.logger.debug(`No keys found for pattern: ${pattern}`);
        return 0;
      }

      await this.redisClient.del(keys);
      this.logger.debug(`Deleted ${keys.length} keys for pattern: ${pattern}`);
      return keys.length;
    } catch (error) {
      this.logger.error(`Cache delete by pattern error:`, error);
      return 0;
    }
  }

  getUserProfileKey(userId: string): string {
    return `${this.USER_PROFILE_PREFIX}${userId}`;
  }

  getUserPublicKey(userId: string): string {
    return `${this.USER_PUBLIC_PREFIX}${userId}`;
  }

  async getUserProfile<T>(userId: string): Promise<T | null> {
    const key = this.getUserProfileKey(userId);
    return this.get<T>(key);
  }

  async setUserProfile<T>(userId: string, profile: T): Promise<void> {
    const key = this.getUserProfileKey(userId);
    await this.set(key, profile, this.USER_PROFILE_TTL);
  }

  async getUserPublic<T>(userId: string): Promise<T | null> {
    const key = this.getUserPublicKey(userId);
    return this.get<T>(key);
  }

  async setUserPublic<T>(userId: string, profile: T): Promise<void> {
    const key = this.getUserPublicKey(userId);
    await this.set(key, profile, this.USER_PUBLIC_TTL);
  }

  async invalidateUser(userId: string): Promise<void> {
    const profileKey = this.getUserProfileKey(userId);
    const publicKey = this.getUserPublicKey(userId);
    await this.del(profileKey, publicKey);
    this.logger.log(`User cache invalidated: ${userId}`);
  }

  async invalidateUsers(userIds: string[]): Promise<void> {
    const keys = userIds.flatMap((userId) => [
      this.getUserProfileKey(userId),
      this.getUserPublicKey(userId),
    ]);
    await this.del(...keys);
    this.logger.log(`Bulk user cache invalidated: ${userIds.length} users`);
  }

  // ===================================
  // Conversation Caching
  // ===================================

  getConversationListKey(userId: string): string {
    return `${this.CONVERSATION_LIST_PREFIX}${userId}`;
  }

  getConversationDetailKey(conversationId: string): string {
    return `${this.CONVERSATION_DETAIL_PREFIX}${conversationId}`;
  }

  async getConversationList<T>(userId: string): Promise<T | null> {
    const key = this.getConversationListKey(userId);
    return this.get<T>(key);
  }

  async setConversationList<T>(userId: string, list: T): Promise<void> {
    const key = this.getConversationListKey(userId);
    await this.set(key, list, this.CONVERSATION_LIST_TTL);
  }

  async getConversationDetail<T>(conversationId: string): Promise<T | null> {
    const key = this.getConversationDetailKey(conversationId);
    return this.get<T>(key);
  }

  async setConversationDetail<T>(
    conversationId: string,
    detail: T,
  ): Promise<void> {
    const key = this.getConversationDetailKey(conversationId);
    await this.set(key, detail, this.CONVERSATION_DETAIL_TTL);
  }

  async invalidateConversation(
    conversationId: string,
    memberUserIds?: string[],
  ): Promise<void> {
    const keys = [this.getConversationDetailKey(conversationId)];

    if (memberUserIds && memberUserIds.length > 0) {
      keys.push(...memberUserIds.map((id) => this.getConversationListKey(id)));
    }

    await this.del(...keys);
    this.logger.log(
      `Conversation cache invalidated: ${conversationId}, ${memberUserIds?.length || 0} members`,
    );
  }

  async invalidateConversationList(userId: string): Promise<void> {
    const key = this.getConversationListKey(userId);
    await this.del(key);
    this.logger.debug(
      `Conversation list cache invalidated for user: ${userId}`,
    );
  }

  // ===================================
  // Friend List Caching
  // ===================================

  getFriendListKey(userId: string): string {
    return `${this.FRIEND_LIST_PREFIX}${userId}`;
  }

  async getFriendList<T>(userId: string): Promise<T | null> {
    const key = this.getFriendListKey(userId);
    return this.get<T>(key);
  }

  async setFriendList<T>(userId: string, list: T): Promise<void> {
    const key = this.getFriendListKey(userId);
    await this.set(key, list, this.FRIEND_LIST_TTL);
  }

  async invalidateFriendList(userId: string): Promise<void> {
    const key = this.getFriendListKey(userId);
    await this.del(key);
    this.logger.debug(`Friend list cache invalidated for user: ${userId}`);
  }

  async invalidateFriendLists(userIds: string[]): Promise<void> {
    const keys = userIds.map((id) => this.getFriendListKey(id));
    await this.del(...keys);
    this.logger.log(
      `Bulk friend list cache invalidated: ${userIds.length} users`,
    );
  }

  // ===================================
  // Recent Messages Caching
  // ===================================

  getRecentMessagesKey(conversationId: string): string {
    return `${this.MESSAGES_RECENT_PREFIX}${conversationId}`;
  }

  async getRecentMessages<T>(conversationId: string): Promise<T | null> {
    const key = this.getRecentMessagesKey(conversationId);
    return this.get<T>(key);
  }

  async setRecentMessages<T>(
    conversationId: string,
    messages: T,
  ): Promise<void> {
    const key = this.getRecentMessagesKey(conversationId);
    await this.set(key, messages, this.MESSAGES_RECENT_TTL);
  }

  async invalidateRecentMessages(conversationId: string): Promise<void> {
    const key = this.getRecentMessagesKey(conversationId);
    await this.del(key);
    this.logger.debug(
      `Recent messages cache invalidated for conversation: ${conversationId}`,
    );
  }

  // ===================================
  // Health Check
  // ===================================

  async isHealthy(): Promise<boolean> {
    try {
      await this.redisClient.ping();
      return true;
    } catch {
      return false;
    }
  }
}
