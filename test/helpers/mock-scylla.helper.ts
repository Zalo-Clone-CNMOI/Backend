/**
 * @file mock-scylla.helper.ts
 *
 * In-memory mock for the Cassandra `Client` injected via SCYLLA_CLIENT.
 * Tracks all CQL queries for assertion and provides a simple in-memory
 * table implementation sufficient for MessageRepository integration tests.
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

export interface CqlQuery {
  query: string;
  params: unknown[];
}

export interface MockRow {
  [key: string]: unknown;
  get(name: string): unknown;
}

function createRow(data: Record<string, unknown>): MockRow {
  return {
    ...data,
    get(name: string) {
      return data[name];
    },
  };
}

/**
 * Create an in-memory mock of the Cassandra `Client`.
 *
 * Tables supported:
 *  - idempotency_by_message_id (message_id → row)
 *  - messages_by_conversation (conversation_id → rows sorted by created_at)
 *  - message_reactions (message_id → rows)
 *  - message_reaction_counts (message_id + reaction_type → counter)
 */
export function createMockScyllaClient() {
  const queries: CqlQuery[] = [];

  // Simple in-memory storage
  const idempotency = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Record<string, unknown>[]>(); // conv_id → rows
  const reactions = new Map<string, Record<string, unknown>[]>(); // msg_id → rows
  const reactionCounts = new Map<string, number>(); // `msg_id:reaction_type` → count

  const execute = jest.fn(
    async (
      query: string,
      params: unknown[] = [],
      _options?: Record<string, unknown>,
    ) => {
      queries.push({ query, params });

      const q = query.replace(/\s+/g, ' ').trim().toUpperCase();

      // ─── idempotency_by_message_id ───────────────────
      if (q.includes('SELECT') && q.includes('IDEMPOTENCY_BY_MESSAGE_ID')) {
        const messageId = params[0] as string;
        const row = idempotency.get(messageId);
        const mappedRow = row ? createRow(row) : null;
        return {
          rowLength: row ? 1 : 0,
          rows: mappedRow ? [mappedRow] : [],
          first: () => mappedRow,
        };
      }

      if (q.includes('INSERT') && q.includes('IDEMPOTENCY_BY_MESSAGE_ID')) {
        const [messageId, conversationId, createdAt, status] = params as [
          string,
          string,
          number,
          string,
        ];

        if (q.includes('IF NOT EXISTS')) {
          const existing = idempotency.get(messageId);
          if (existing) {
            const existingRow = createRow({
              '[applied]': false,
              ...existing,
            });
            return {
              rowLength: 1,
              rows: [existingRow],
              first: () => existingRow,
            };
          }

          idempotency.set(messageId, {
            message_id: messageId,
            conversation_id: conversationId,
            created_at: createdAt,
            status,
          });

          const appliedRow = createRow({ '[applied]': true });
          return {
            rowLength: 1,
            rows: [appliedRow],
            first: () => appliedRow,
          };
        }

        idempotency.set(messageId, {
          message_id: messageId,
          conversation_id: conversationId,
          created_at: createdAt,
          status,
        });
        return { rowLength: 0, rows: [], first: () => null };
      }

      if (q.includes('UPDATE') && q.includes('IDEMPOTENCY_BY_MESSAGE_ID')) {
        if (q.includes('IF STATUS = ?')) {
          const [nextStatus, messageId, expectedStatus] = params as [
            string,
            string,
            string,
          ];
          const current = idempotency.get(messageId);
          const applied = !!current && current.status === expectedStatus;

          if (applied && current) {
            current.status = nextStatus;
            idempotency.set(messageId, current);
          }

          const conditionalRow = createRow({
            '[applied]': applied,
            message_id: messageId,
            status: current?.status,
          });
          return {
            rowLength: 1,
            rows: [conditionalRow],
            first: () => conditionalRow,
          };
        }

        const [nextStatus, messageId] = params as [string, string];
        const current = idempotency.get(messageId);
        if (current) {
          current.status = nextStatus;
          idempotency.set(messageId, current);
        }
        return { rowLength: 0, rows: [], first: () => null };
      }

      if (q.includes('DELETE') && q.includes('IDEMPOTENCY_BY_MESSAGE_ID')) {
        const [messageId] = params as [string];
        idempotency.delete(messageId);
        return { rowLength: 0, rows: [], first: () => null };
      }

      // ─── messages_by_conversation ────────────────────
      if (q.includes('INSERT') && q.includes('MESSAGES_BY_CONVERSATION')) {
        const [convId, createdAt, msgId, senderId, body, attachments, replyTo] =
          params;
        const row: Record<string, unknown> = {
          conversation_id: convId,
          created_at: createdAt,
          message_id: msgId,
          sender_id: senderId,
          body,
          attachments,
          reply_to_message_id: replyTo,
          edited_at: null,
          deleted_at: null,
        };
        const list = messages.get(convId as string) ?? [];
        list.push(row);
        messages.set(convId as string, list);
        return { rowLength: 0, rows: [] };
      }

      if (
        q.includes('SELECT') &&
        q.includes('MESSAGES_BY_CONVERSATION') &&
        q.includes('CREATED_AT = ?') &&
        q.includes('MESSAGE_ID = ?')
      ) {
        // getMessage by exact key
        const [convId, createdAt, msgId] = params;
        const list = messages.get(convId as string) ?? [];
        const found = list.find(
          (r) => r.created_at === createdAt && r.message_id === msgId,
        );
        return {
          rowLength: found ? 1 : 0,
          rows: found ? [createRow(found)] : [],
        };
      }

      if (q.includes('SELECT') && q.includes('MESSAGES_BY_CONVERSATION')) {
        // getMessages (pagination)
        const convId = params[0] as string;
        const list = (messages.get(convId) ?? []).slice();
        // Sort DESC by created_at
        list.sort(
          (a, b) => (b.created_at as number) - (a.created_at as number),
        );

        let filtered = list;
        if (q.includes('CREATED_AT < ?')) {
          const cursor = params[1] as number;
          filtered = list.filter((r) => (r.created_at as number) < cursor);
        }

        const limit = params[params.length - 1] as number;
        const sliced = filtered.slice(0, limit);
        return {
          rowLength: sliced.length,
          rows: sliced.map(createRow),
        };
      }

      if (
        q.includes('UPDATE') &&
        q.includes('MESSAGES_BY_CONVERSATION') &&
        q.includes('BODY = ?') &&
        q.includes('EDITED_AT = ?')
      ) {
        // updateMessageBody
        const [newBody, editedAt, convId, createdAt, msgId] = params;
        const list = messages.get(convId as string) ?? [];
        const row = list.find(
          (r) => r.created_at === createdAt && r.message_id === msgId,
        );
        if (row) {
          row.body = newBody;
          row.edited_at = editedAt;
        }
        return { rowLength: 0, rows: [] };
      }

      if (
        q.includes('UPDATE') &&
        q.includes('MESSAGES_BY_CONVERSATION') &&
        q.includes('DELETED_AT = ?')
      ) {
        // softDeleteMessage
        const [deletedAt, convId, createdAt, msgId] = params;
        const list = messages.get(convId as string) ?? [];
        const row = list.find(
          (r) => r.created_at === createdAt && r.message_id === msgId,
        );
        if (row) {
          row.deleted_at = deletedAt;
          row.body = '';
        }
        return { rowLength: 0, rows: [] };
      }

      // ─── message_reactions ───────────────────────────
      if (q.includes('INSERT') && q.includes('MESSAGE_REACTIONS')) {
        const [msgId, userId, reactionType, createdAt] = params as string[];
        const list = reactions.get(msgId) ?? [];
        list.push({
          message_id: msgId,
          user_id: userId,
          reaction_type: reactionType,
          created_at: createdAt,
        });
        reactions.set(msgId, list);
        return { rowLength: 0, rows: [] };
      }

      if (
        q.includes('SELECT') &&
        q.includes('MESSAGE_REACTIONS') &&
        q.includes('USER_ID = ?')
      ) {
        const [msgId, userId] = params as string[];
        const list = (reactions.get(msgId) ?? []).filter(
          (r) => r.user_id === userId,
        );
        return {
          rowLength: list.length,
          rows: list.map(createRow),
        };
      }

      if (
        q.includes('SELECT') &&
        q.includes('MESSAGE_REACTIONS') &&
        !q.includes('USER_ID')
      ) {
        const msgId = params[0] as string;
        const list = reactions.get(msgId) ?? [];
        return {
          rowLength: list.length,
          rows: list.map(createRow),
        };
      }

      if (q.includes('DELETE') && q.includes('MESSAGE_REACTIONS')) {
        const [msgId, userId] = params as string[];
        const list = reactions.get(msgId) ?? [];
        reactions.set(
          msgId,
          list.filter((r) => r.user_id !== userId),
        );
        return { rowLength: 0, rows: [] };
      }

      // ─── message_reaction_counts ─────────────────────
      if (
        q.includes('UPDATE') &&
        q.includes('MESSAGE_REACTION_COUNTS') &&
        q.includes('COUNT + 1')
      ) {
        const [msgId, reactionType] = params as string[];
        const key = `${msgId}:${reactionType}`;
        reactionCounts.set(key, (reactionCounts.get(key) ?? 0) + 1);
        return { rowLength: 0, rows: [] };
      }

      if (
        q.includes('UPDATE') &&
        q.includes('MESSAGE_REACTION_COUNTS') &&
        q.includes('COUNT - 1')
      ) {
        const [msgId, reactionType] = params as string[];
        const key = `${msgId}:${reactionType}`;
        reactionCounts.set(key, (reactionCounts.get(key) ?? 0) - 1);
        return { rowLength: 0, rows: [] };
      }

      if (q.includes('SELECT') && q.includes('MESSAGE_REACTION_COUNTS')) {
        const msgId = params[0] as string;
        const rows: Record<string, unknown>[] = [];
        for (const [k, v] of reactionCounts) {
          if (k.startsWith(`${msgId}:`)) {
            rows.push({
              reaction_type: k.split(':')[1],
              count: v,
            });
          }
        }
        return {
          rowLength: rows.length,
          rows: rows.map(createRow),
        };
      }

      // Default: empty result
      return { rowLength: 0, rows: [] };
    },
  );

  return {
    client: { execute } as unknown as Record<string, jest.Mock>,
    execute,
    queries,
    // Direct access to in-memory stores for assertion
    stores: { idempotency, messages, reactions, reactionCounts },
    /** Reset all in-memory data and recorded queries */
    reset() {
      queries.length = 0;
      idempotency.clear();
      messages.clear();
      reactions.clear();
      reactionCounts.clear();
      execute.mockClear();
    },
  };
}
