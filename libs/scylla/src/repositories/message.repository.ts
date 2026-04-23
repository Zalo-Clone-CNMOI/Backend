import { Inject, Injectable } from '@nestjs/common';
import type { Client, types } from 'cassandra-driver';
import { SCYLLA_CLIENT } from '../scylla.tokens';
import {
  CursorPaginatedResult,
  CursorPaginationOptions,
  MessageAttachment,
  MessageReaction,
  PinnedMessageRecord,
  PersistedMessage,
  ReactionType,
} from '@app/types/interfaces/chat.interface';

export interface MessageProcessingState {
  message_id: string;
  conversation_id: string;
  created_at: number;
  status: string;
}

@Injectable()
export class MessageRepository {
  constructor(@Inject(SCYLLA_CLIENT) private readonly client: Client) {}

  async tryBeginMessageProcessing(
    messageId: string,
    conversationId: string,
    createdAt: number,
  ): Promise<boolean> {
    const result = await this.client.execute(
      'INSERT INTO idempotency_by_message_id (message_id, conversation_id, created_at, status) VALUES (?, ?, ?, ?) IF NOT EXISTS',
      [messageId, conversationId, createdAt, 'pending'],
      { prepare: true },
    );

    return this.getAppliedValue(result);
  }

  async getMessageProcessingState(
    messageId: string,
  ): Promise<MessageProcessingState | null> {
    const result = await this.client.execute(
      'SELECT message_id, conversation_id, created_at, status FROM idempotency_by_message_id WHERE message_id = ?',
      [messageId],
      { prepare: true },
    );

    if (result.rowLength === 0) {
      return null;
    }

    return this.rowToMessageProcessingState(result.rows[0]);
  }

  async tryClaimPendingReplay(messageId: string): Promise<boolean> {
    const result = await this.client.execute(
      'UPDATE idempotency_by_message_id SET status = ? WHERE message_id = ? IF status = ?',
      ['replaying', messageId, 'pending'],
      { prepare: true },
    );

    return this.getAppliedValue(result);
  }

  async restoreMessageProcessingToPending(messageId: string): Promise<void> {
    await this.client.execute(
      'UPDATE idempotency_by_message_id SET status = ? WHERE message_id = ?',
      ['pending', messageId],
      { prepare: true },
    );
  }

  async markMessageStored(messageId: string): Promise<void> {
    await this.client.execute(
      'UPDATE idempotency_by_message_id SET status = ? WHERE message_id = ?',
      ['stored', messageId],
      { prepare: true },
    );
  }

  async clearMessageProcessing(messageId: string): Promise<void> {
    await this.client.execute(
      'DELETE FROM idempotency_by_message_id WHERE message_id = ?',
      [messageId],
      { prepare: true },
    );
  }

  async wasMessageSeen(messageId: string): Promise<boolean> {
    const result = await this.client.execute(
      'SELECT message_id FROM idempotency_by_message_id WHERE message_id = ?',
      [messageId],
      { prepare: true },
    );
    return result.rowLength > 0;
  }

  async markMessageSeen(
    messageId: string,
    conversationId: string,
    createdAt: number,
  ): Promise<boolean> {
    const result = await this.client.execute(
      'INSERT INTO idempotency_by_message_id (message_id, conversation_id, created_at, status) VALUES (?, ?, ?, ?) IF NOT EXISTS',
      [messageId, conversationId, createdAt, 'stored'],
      { prepare: true },
    );

    return this.getAppliedValue(result);
  }

  async insertMessage(message: PersistedMessage): Promise<void> {
    const attachmentsJson = message.attachments
      ? JSON.stringify(message.attachments)
      : null;

    const forwardedFromJson = message.forwarded_from
      ? JSON.stringify(message.forwarded_from)
      : null;

    // Logged BATCH ensures both tables are written atomically.
    // If the coordinator fails after the batch log is written, the batch
    // will be replayed by the cluster on recovery.
    await this.client.batch(
      [
        {
          query: `INSERT INTO messages_by_conversation
                  (conversation_id, created_at, message_id, sender_id, body, attachments, reply_to_message_id, forwarded_from)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            message.conversation_id,
            message.created_at,
            message.message_id,
            message.sender_id,
            message.body,
            attachmentsJson,
            message.reply_to_message_id || null,
            forwardedFromJson,
          ],
        },
        {
          query:
            'INSERT INTO messages_by_id (message_id, conversation_id, created_at) VALUES (?, ?, ?)',
          params: [
            message.message_id,
            message.conversation_id,
            message.created_at,
          ],
        },
      ],
      { prepare: true },
    );
  }

  async insertSystemMessage(message: {
    message_id: string;
    conversation_id: string;
    message_type: string;
    system_event_type: string;
    metadata: Record<string, unknown>;
    body: string;
    created_at: number;
  }): Promise<void> {
    const metadataJson = JSON.stringify(message.metadata);

    await this.client.batch(
      [
        {
          query: `INSERT INTO messages_by_conversation
                  (conversation_id, created_at, message_id, sender_id, body,
                   message_type, system_event_type, metadata)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            message.conversation_id,
            message.created_at,
            message.message_id,
            'SYSTEM',
            message.body,
            message.message_type,
            message.system_event_type,
            metadataJson,
          ],
        },
        {
          query:
            'INSERT INTO messages_by_id (message_id, conversation_id, created_at) VALUES (?, ?, ?)',
          params: [
            message.message_id,
            message.conversation_id,
            message.created_at,
          ],
        },
      ],
      { prepare: true },
    );
  }

  async insertInviteMessage(message: {
    message_id: string;
    conversation_id: string;
    sender_id: string;
    message_type: string;
    metadata: Record<string, unknown>;
    body: string;
    created_at: number;
  }): Promise<void> {
    const metadataJson = JSON.stringify(message.metadata);

    await this.client.batch(
      [
        {
          query: `INSERT INTO messages_by_conversation
                  (conversation_id, created_at, message_id, sender_id, body,
                   message_type, metadata)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [
            message.conversation_id,
            message.created_at,
            message.message_id,
            message.sender_id,
            message.body,
            message.message_type,
            metadataJson,
          ],
        },
        {
          query:
            'INSERT INTO messages_by_id (message_id, conversation_id, created_at) VALUES (?, ?, ?)',
          params: [
            message.message_id,
            message.conversation_id,
            message.created_at,
          ],
        },
      ],
      { prepare: true },
    );
  }

  async updateMessageMetadata(
    conversationId: string,
    createdAt: number,
    messageId: string,
    newMetadata: Record<string, unknown>,
  ): Promise<void> {
    const metadataJson = JSON.stringify(newMetadata);
    await this.client.execute(
      `UPDATE messages_by_conversation 
       SET metadata = ? 
       WHERE conversation_id = ? AND created_at = ? AND message_id = ?`,
      [metadataJson, conversationId, createdAt, messageId],
      { prepare: true },
    );
  }

  async getMessages(
    conversationId: string,
    options: CursorPaginationOptions = {},
  ): Promise<CursorPaginatedResult<PersistedMessage>> {
    const limit = Math.min(options.limit ?? 50, 100);
    const fetchLimit = limit + 1;

    let query: string;
    let params: unknown[];

    if (options.cursor) {
      const cursorTimestamp = this.decodeCursor(options.cursor);
      query = `SELECT * FROM messages_by_conversation 
               WHERE conversation_id = ? AND created_at < ? 
               ORDER BY created_at DESC LIMIT ?`;
      params = [conversationId, cursorTimestamp, fetchLimit];
    } else {
      query = `SELECT * FROM messages_by_conversation 
               WHERE conversation_id = ? 
               ORDER BY created_at DESC LIMIT ?`;
      params = [conversationId, fetchLimit];
    }

    const result = await this.client.execute(query, params, { prepare: true });
    const rows = result.rows;

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.rowToMessage(row));

    const nextCursor =
      hasMore && items.length > 0
        ? this.encodeCursor(items[items.length - 1].created_at)
        : null;

    return { items, next_cursor: nextCursor, has_more: hasMore };
  }

  async getAllMessages(
    conversationId: string,
    limit = 500,
  ): Promise<PersistedMessage[]> {
    const result = await this.client.execute(
      `SELECT * FROM messages_by_conversation WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
      [conversationId, limit],
      { prepare: true },
    );
    return result.rows.map((row) => this.rowToMessage(row));
  }

  async getMessage(
    conversationId: string,
    createdAt: number,
    messageId: string,
  ): Promise<PersistedMessage | null> {
    const result = await this.client.execute(
      `SELECT * FROM messages_by_conversation 
       WHERE conversation_id = ? AND created_at = ? AND message_id = ?`,
      [conversationId, createdAt, messageId],
      { prepare: true },
    );

    if (result.rowLength === 0) return null;
    return this.rowToMessage(result.rows[0]);
  }

  async getMessageById(
    messageId: string,
  ): Promise<{ conversation_id: string; created_at: number } | null> {
    const result = await this.client.execute(
      'SELECT conversation_id, created_at FROM messages_by_id WHERE message_id = ?',
      [messageId],
      { prepare: true },
    );

    if (result.rowLength === 0) return null;

    const row = result.rows[0];
    return {
      conversation_id: row.get('conversation_id') as string,
      created_at: this.toNumber(row.get('created_at')),
    };
  }

  async getPinnedMessage(
    conversationId: string,
    messageId: string,
  ): Promise<PinnedMessageRecord | null> {
    const result = await this.client.execute(
      `SELECT conversation_id, message_id, created_at, pinned_by, pinned_at
       FROM pinned_message_by_message
       WHERE conversation_id = ? AND message_id = ?`,
      [conversationId, messageId],
      { prepare: true },
    );

    if (result.rowLength === 0) {
      return null;
    }

    return this.rowToPinnedMessage(result.rows[0]);
  }

  async getPinnedMessages(
    conversationId: string,
    limit = 20,
  ): Promise<PinnedMessageRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await this.client.execute(
      `SELECT conversation_id, message_id, created_at, pinned_by, pinned_at
       FROM pinned_messages_by_conversation
       WHERE conversation_id = ?
       LIMIT ?`,
      [conversationId, safeLimit],
      { prepare: true },
    );

    return result.rows.map((row) => this.rowToPinnedMessage(row));
  }

  async pinMessage(record: PinnedMessageRecord): Promise<void> {
    await this.client.batch(
      [
        {
          query: `INSERT INTO pinned_messages_by_conversation
                  (conversation_id, pinned_at, message_id, created_at, pinned_by)
                  VALUES (?, ?, ?, ?, ?)`,
          params: [
            record.conversation_id,
            record.pinned_at,
            record.message_id,
            record.created_at,
            record.pinned_by,
          ],
        },
        {
          query: `INSERT INTO pinned_message_by_message
                  (conversation_id, message_id, created_at, pinned_by, pinned_at)
                  VALUES (?, ?, ?, ?, ?)`,
          params: [
            record.conversation_id,
            record.message_id,
            record.created_at,
            record.pinned_by,
            record.pinned_at,
          ],
        },
      ],
      { prepare: true },
    );
  }

  async unpinMessage(record: PinnedMessageRecord): Promise<void> {
    await this.client.batch(
      [
        {
          query: `DELETE FROM pinned_messages_by_conversation
                  WHERE conversation_id = ? AND pinned_at = ? AND message_id = ?`,
          params: [record.conversation_id, record.pinned_at, record.message_id],
        },
        {
          query: `DELETE FROM pinned_message_by_message
                  WHERE conversation_id = ? AND message_id = ?`,
          params: [record.conversation_id, record.message_id],
        },
      ],
      { prepare: true },
    );
  }

  async updateMessageBody(
    conversationId: string,
    createdAt: number,
    messageId: string,
    newBody: string,
    editedAt: number,
  ): Promise<void> {
    await this.client.execute(
      `UPDATE messages_by_conversation 
       SET body = ?, edited_at = ? 
       WHERE conversation_id = ? AND created_at = ? AND message_id = ?`,
      [newBody, editedAt, conversationId, createdAt, messageId],
      { prepare: true },
    );
  }

  async softDeleteMessage(
    conversationId: string,
    createdAt: number,
    messageId: string,
    deletedAt: number,
  ): Promise<void> {
    await this.client.execute(
      `UPDATE messages_by_conversation 
       SET deleted_at = ?, body = '' 
       WHERE conversation_id = ? AND created_at = ? AND message_id = ?`,
      [deletedAt, conversationId, createdAt, messageId],
      { prepare: true },
    );
  }

  async trySoftDeleteMessage(
    conversationId: string,
    createdAt: number,
    messageId: string,
    deletedAt: number,
  ): Promise<boolean> {
    const result = await this.client.execute(
      `UPDATE messages_by_conversation
       SET deleted_at = ?, body = ''
       WHERE conversation_id = ? AND created_at = ? AND message_id = ?
       IF deleted_at = null`,
      [deletedAt, conversationId, createdAt, messageId],
      { prepare: true },
    );

    const appliedValue: unknown = result.first()?.get('[applied]');
    return typeof appliedValue === 'boolean' ? appliedValue : false;
  }

  async addReaction(reaction: MessageReaction): Promise<void> {
    await this.client.execute(
      `INSERT INTO message_reactions 
       (message_id, user_id, reaction_type, created_at) 
       VALUES (?, ?, ?, ?)`,
      [
        reaction.message_id,
        reaction.user_id,
        reaction.reaction_type,
        reaction.created_at,
      ],
      { prepare: true },
    );

    // Counter table: atomic increment — no race conditions
    await this.client.execute(
      `UPDATE message_reaction_counts 
       SET count = count + 1 
       WHERE message_id = ? AND reaction_type = ?`,
      [reaction.message_id, reaction.reaction_type],
      { prepare: true },
    );
  }

  async removeReaction(messageId: string, userId: string): Promise<void> {
    const result = await this.client.execute(
      `SELECT reaction_type FROM message_reactions WHERE message_id = ? AND user_id = ?`,
      [messageId, userId],
      { prepare: true },
    );

    await this.client.execute(
      `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?`,
      [messageId, userId],
      { prepare: true },
    );

    if (result.rowLength > 0) {
      // Counter table: one atomic decrement per reaction_type row
      const decrementPromises: Promise<types.ResultSet>[] = [];
      for (const row of result.rows) {
        const reactionType = row.get('reaction_type') as string;
        decrementPromises.push(
          this.client.execute(
            `UPDATE message_reaction_counts 
             SET count = count - 1 
             WHERE message_id = ? AND reaction_type = ?`,
            [messageId, reactionType],
            { prepare: true },
          ),
        );
      }
      await Promise.all(decrementPromises);
    }
  }

  async getReactions(messageId: string): Promise<MessageReaction[]> {
    const result = await this.client.execute(
      `SELECT * FROM message_reactions WHERE message_id = ?`,
      [messageId],
      { prepare: true },
    );

    return result.rows.map((row: types.Row) => ({
      message_id: row.get('message_id') as string,
      user_id: row.get('user_id') as string,
      reaction_type: row.get('reaction_type') as ReactionType,
      created_at: Number(row.get('created_at')),
    }));
  }

  async getReactionsByUser(
    messageId: string,
    userId: string,
  ): Promise<MessageReaction[]> {
    const result = await this.client.execute(
      `SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?`,
      [messageId, userId],
      { prepare: true },
    );

    return result.rows.map((row: types.Row) => ({
      message_id: row.get('message_id') as string,
      user_id: row.get('user_id') as string,
      reaction_type: row.get('reaction_type') as ReactionType,
      created_at: Number(row.get('created_at')),
    }));
  }

  async getReactionStats(
    messageId: string,
  ): Promise<Record<string, number> | null> {
    const result = await this.client.execute(
      `SELECT reaction_type, count FROM message_reaction_counts WHERE message_id = ?`,
      [messageId],
      { prepare: true },
    );

    if (result.rowLength === 0) return null;

    const stats: Record<string, number> = {};
    for (const row of result.rows) {
      const reactionType = row.get('reaction_type') as string;
      // ScyllaDB counters are returned as Long; coerce to JS number
      const count = row.get('count') as { toNumber?: () => number } | number;
      stats[reactionType] =
        typeof count === 'object' && count !== null && 'toNumber' in count
          ? (count as { toNumber: () => number }).toNumber()
          : Number(count);
    }

    return stats;
  }

  private rowToMessage(row: types.Row): PersistedMessage {
    const attachmentsRaw = row.get('attachments') as string | null;
    let attachments: MessageAttachment[] | undefined;

    if (attachmentsRaw) {
      try {
        attachments = JSON.parse(attachmentsRaw) as MessageAttachment[];
      } catch {
        attachments = undefined;
      }
    }

    const forwardedFromRaw = row.get('forwarded_from') as string | null;
    let forwarded_from: PersistedMessage['forwarded_from'] | undefined;
    if (forwardedFromRaw) {
      try {
        forwarded_from = JSON.parse(
          forwardedFromRaw,
        ) as PersistedMessage['forwarded_from'];
      } catch {
        forwarded_from = undefined;
      }
    }

    const metadataRaw = row.get('metadata') as string | null;
    let parsedMetadata: Record<string, unknown> | undefined = undefined;

    if (metadataRaw) {
      try {
        parsedMetadata = JSON.parse(metadataRaw) as Record<string, unknown>;
      } catch {
        parsedMetadata = {};
      }
    }

    return {
      message_id: row.get('message_id') as string,
      conversation_id: row.get('conversation_id') as string,
      sender_id: row.get('sender_id') as string,
      body: (row.get('body') as string | null) || '',
      created_at: Number(row.get('created_at')),
      attachments,
      reply_to_message_id:
        (row.get('reply_to_message_id') as string | null) || undefined,
      edited_at: row.get('edited_at')
        ? Number(row.get('edited_at'))
        : undefined,
      deleted_at: row.get('deleted_at')
        ? Number(row.get('deleted_at'))
        : undefined,
      message_type: (row.get('message_type') as string | null) || undefined,
      system_event_type:
        (row.get('system_event_type') as string | null) || undefined,
      metadata: parsedMetadata,
      forwarded_from,
    };
  }

  private rowToPinnedMessage(row: types.Row): PinnedMessageRecord {
    return {
      conversation_id: row.get('conversation_id') as string,
      message_id: row.get('message_id') as string,
      created_at: this.toNumber(row.get('created_at')),
      pinned_by: row.get('pinned_by') as string,
      pinned_at: this.toNumber(row.get('pinned_at')),
    };
  }

  private encodeCursor(timestamp: number): string {
    return Buffer.from(timestamp.toString()).toString('base64');
  }

  private decodeCursor(cursor: string): number {
    return parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  }

  private getAppliedValue(result: types.ResultSet): boolean {
    const firstRow = this.getFirstRow(result);
    if (!firstRow) {
      return false;
    }

    const appliedValue: unknown = firstRow.get('[applied]');
    return typeof appliedValue === 'boolean' ? appliedValue : false;
  }

  private getFirstRow(result: types.ResultSet): types.Row | null {
    if (typeof result.first === 'function') {
      return result.first() ?? null;
    }

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  private rowToMessageProcessingState(row: types.Row): MessageProcessingState {
    return {
      message_id: row.get('message_id') as string,
      conversation_id: row.get('conversation_id') as string,
      created_at: this.toNumber(row.get('created_at')),
      status: (row.get('status') as string) || 'unknown',
    };
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }

    if (this.hasToNumber(value)) {
      return value.toNumber();
    }

    return Number(value);
  }

  private hasToNumber(value: unknown): value is { toNumber: () => number } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function'
    );
  }
}
