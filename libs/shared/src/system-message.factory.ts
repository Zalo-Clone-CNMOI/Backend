import { randomUUID } from 'crypto';
import {
  ChatSystemMessageCommand,
  SystemEventType,
  SystemMessageMetadata,
} from '@libs/contracts';
import { MessageType } from '@app/constant';

export class SystemMessageFactory {
  static create(params: {
    conversationId: string;
    systemEventType: SystemEventType;
    metadata: SystemMessageMetadata;
    traceId: string;
    bodyFallback: string;
  }): ChatSystemMessageCommand {
    return {
      message_id: randomUUID(),
      conversation_id: params.conversationId,
      message_type: MessageType.SYSTEM,
      system_event_type: params.systemEventType,
      metadata: params.metadata,
      body: params.bodyFallback,
      created_at: Date.now(),
      trace_id: params.traceId,
    };
  }
}
