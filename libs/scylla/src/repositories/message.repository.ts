import { Inject, Injectable } from '@nestjs/common';
import type { Client, types } from 'cassandra-driver';
import { SCYLLA_CLIENT } from '../scylla.tokens';
import {
  CursorPaginatedResult,
  CursorPaginationOptions,
  MessageAttachment,
  MessageReaction,
  PersistedMessage,
  ReactionType,
} from '@app/types/interfaces/chat.interface';

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

    const appliedValue: unknown = result.first()?.get('[applied]');
    return typeof appliedValue === 'boolean' ? appliedValue : false;
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
  ): Promise<void> {
    await this.client.execute(
      'INSERT INTO idempotency_by_message_id (message_id, conversation_id, created_at, status) VALUES (?, ?, ?, ?)',
      [messageId, conversationId, createdAt, 'stored'],
      { prepare: true },
    );
  }

  async insertMessage(message: PersistedMessage): Promise<void> {
    const attachmentsJson = message.attachments
      ? JSON.stringify(message.attachments)
      : null;

    await this.client.execute(
      `INSERT INTO messages_by_conversation 
       (conversation_id, created_at, message_id, sender_id, body, attachments, reply_to_message_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        message.conversation_id,
        message.created_at,
        message.message_id,
        message.sender_id,
        message.body,
        attachmentsJson,
        message.reply_to_message_id || null,
      ],
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
    };
  }

  private encodeCursor(timestamp: number): string {
    return Buffer.from(timestamp.toString()).toString('base64');
  }

  private decodeCursor(cursor: string): number {
    return parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  }
}
