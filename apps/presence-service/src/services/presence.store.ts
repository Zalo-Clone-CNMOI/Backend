import { Injectable } from '@nestjs/common';
import type {
  PresenceSource,
  PresenceStatus,
  PresenceUpdatedEvent,
} from '@libs/contracts';

interface PresenceEntry {
  userId: string;
  socketId: string;
  lastSeenAt: number;
  expiresAt: number;
  status: PresenceStatus;
}

@Injectable()
export class PresenceStore {
  // Reasonable defaults (you asked for it): heartbeat 15s, TTL 60s
  private readonly ttlMs = Number(process.env.PRESENCE_TTL_MS ?? 60_000);

  private readonly bySocketId = new Map<string, PresenceEntry>();

  upsertOnline(
    userId: string,
    socketId: string,
    now: number,
    source: PresenceSource,
  ): PresenceUpdatedEvent {
    const entry: PresenceEntry = {
      userId,
      socketId,
      lastSeenAt: now,
      expiresAt: now + this.ttlMs,
      status: 'online',
    };
    this.bySocketId.set(socketId, entry);
    return {
      user_id: userId,
      status: 'online',
      last_seen_at: now,
      expires_at: entry.expiresAt,
      source,
    };
  }

  markOffline(
    userId: string,
    socketId: string,
    now: number,
    source: PresenceSource,
  ): PresenceUpdatedEvent {
    this.bySocketId.delete(socketId);
    return {
      user_id: userId,
      status: 'offline',
      last_seen_at: now,
      expires_at: now,
      source,
    };
  }

  cleanupExpired(now: number): PresenceUpdatedEvent[] {
    const expired: PresenceUpdatedEvent[] = [];

    for (const [socketId, entry] of this.bySocketId.entries()) {
      if (entry.expiresAt <= now) {
        this.bySocketId.delete(socketId);
        expired.push({
          user_id: entry.userId,
          status: 'offline',
          last_seen_at: entry.lastSeenAt,
          expires_at: entry.expiresAt,
          source: 'ttl_expire',
        });
      }
    }

    return expired;
  }
}
