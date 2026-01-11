import { Inject, Injectable } from '@nestjs/common';
import type { Client } from 'cassandra-driver';
import { SCYLLA_CLIENT } from '../scylla.tokens';

export interface PersistedMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
}

@Injectable()
export class MessageRepository {
  constructor(@Inject(SCYLLA_CLIENT) private readonly client: Client) {}

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
    await this.client.execute(
      'INSERT INTO messages_by_conversation (conversation_id, created_at, message_id, sender_id, body) VALUES (?, ?, ?, ?, ?)',
      [
        message.conversation_id,
        message.created_at,
        message.message_id,
        message.sender_id,
        message.body,
      ],
      { prepare: true },
    );
  }
}
