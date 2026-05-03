import { Inject, Injectable } from '@nestjs/common';
import type { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  KafkaTopics,
  type CallStateSnapshot,
  type CallStateUpdatedEvent,
} from '@libs/contracts';

@Injectable()
export class CallEventsPublisher {
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  publishStateUpdate(
    conversationId: string,
    state: CallStateSnapshot | null,
    options?: {
      requestedBy?: string;
      reason?: string;
      traceId?: string;
      details?: Record<string, unknown>;
    },
  ): void {
    const event: CallStateUpdatedEvent = {
      conversation_id: conversationId,
      state,
      requested_by: options?.requestedBy,
      updated_at: Date.now(),
      reason: options?.reason,
      trace_id: options?.traceId,
      details: options?.details,
    };

    this.kafkaClient.emit(KafkaTopics.CallStateUpdated, {
      key: conversationId,
      value: event,
    });
  }

  publishNotMemberUpdate(
    conversationId: string,
    userId: string,
    traceId?: string,
  ): void {
    this.publishStateUpdate(conversationId, null, {
      requestedBy: userId,
      reason: 'not_member',
      traceId,
      details: { conversation_id: conversationId },
    });
  }

  publishCallNotFoundUpdate(
    conversationId: string,
    userId: string,
    state: CallStateSnapshot | null,
    traceId?: string,
  ): void {
    this.publishStateUpdate(conversationId, state, {
      requestedBy: userId,
      reason: 'call_not_found',
      traceId,
    });
  }
}
