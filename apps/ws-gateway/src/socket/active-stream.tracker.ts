import { Injectable } from '@nestjs/common';

/**
 * Tracks in-flight Zai streams per conversation so the gateway can abort them
 * when the last recipient of a conversation disconnects (Phase 6 C12).
 *
 * Zai chunks fan out to the `conv:{id}` room (all members), so a single
 * member's disconnect must NOT abort the stream — only the departure of the
 * last recipient does. This tracker holds the conversation→streams mapping; the
 * gateway checks room occupancy at disconnect time before publishing an abort.
 */
@Injectable()
export class ActiveStreamTracker {
  /** conversationId → set of active stream_ids. */
  private readonly streamsByConversation = new Map<string, Set<string>>();
  /** stream_id → conversationId (reverse lookup for complete()). */
  private readonly conversationByStream = new Map<string, string>();

  /** Record a stream as active for a conversation. Idempotent. */
  track(streamId: string, conversationId: string): void {
    this.conversationByStream.set(streamId, conversationId);
    let set = this.streamsByConversation.get(conversationId);
    if (!set) {
      set = new Set<string>();
      this.streamsByConversation.set(conversationId, set);
    }
    set.add(streamId);
  }

  /** Drop a finished (or aborted) stream. Idempotent. */
  complete(streamId: string): void {
    const conversationId = this.conversationByStream.get(streamId);
    this.conversationByStream.delete(streamId);
    if (!conversationId) return;
    const set = this.streamsByConversation.get(conversationId);
    if (!set) return;
    set.delete(streamId);
    if (set.size === 0) {
      this.streamsByConversation.delete(conversationId);
    }
  }

  /** Active stream_ids for a conversation (empty array when none). */
  getActiveStreams(conversationId: string): string[] {
    return Array.from(this.streamsByConversation.get(conversationId) ?? []);
  }
}
