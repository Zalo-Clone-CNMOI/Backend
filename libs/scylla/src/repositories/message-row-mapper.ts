import type { types } from 'cassandra-driver';
import type {
  PersistedMessage,
  PinnedMessageRecord,
  MessageAttachment,
} from '@app/types/interfaces/chat.interface';

export interface MessageProcessingState {
  message_id: string;
  conversation_id: string;
  created_at: number;
  status: string;
}

export function hasToNumber(
  value: unknown,
): value is { toNumber: () => number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  );
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (hasToNumber(value)) {
    return value.toNumber();
  }

  return Number(value);
}

export function getFirstRow(result: types.ResultSet): types.Row | null {
  if (typeof result.first === 'function') {
    return result.first() ?? null;
  }

  return result.rows.length > 0 ? result.rows[0] : null;
}

export function getAppliedValue(result: types.ResultSet): boolean {
  const firstRow = getFirstRow(result);
  if (!firstRow) {
    return false;
  }

  const appliedValue: unknown = firstRow.get('[applied]');
  return typeof appliedValue === 'boolean' ? appliedValue : false;
}

export function encodeCursor(timestamp: number): string {
  return Buffer.from(timestamp.toString()).toString('base64');
}

export function decodeCursor(cursor: string): number {
  return parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
}

export function rowToPinnedMessage(row: types.Row): PinnedMessageRecord {
  return {
    conversation_id: row.get('conversation_id') as string,
    message_id: row.get('message_id') as string,
    created_at: toNumber(row.get('created_at')),
    pinned_by: row.get('pinned_by') as string,
    pinned_at: toNumber(row.get('pinned_at')),
  };
}

export function rowToMessageProcessingState(
  row: types.Row,
): MessageProcessingState {
  return {
    message_id: row.get('message_id') as string,
    conversation_id: row.get('conversation_id') as string,
    created_at: toNumber(row.get('created_at')),
    status: (row.get('status') as string) || 'unknown',
  };
}

export function rowToMessage(row: types.Row): PersistedMessage {
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
    edited_at: row.get('edited_at') ? Number(row.get('edited_at')) : undefined,
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
