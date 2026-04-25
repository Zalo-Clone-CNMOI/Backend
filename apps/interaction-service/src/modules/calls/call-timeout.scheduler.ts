import { Injectable, Inject, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { ClientKafka } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import {
  KafkaTopics,
  type CallTimedOutEvent,
  type CallEndedEvent,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { CallTimeoutService } from './call-timeout.service';
import { CallStateStore } from './call-state.store';

@Injectable()
export class CallTimeoutScheduler {
  private readonly logger = new Logger(CallTimeoutScheduler.name);

  constructor(
    private readonly timeoutService: CallTimeoutService,
    private readonly stateStore: CallStateStore,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  @Interval(5000)
  async checkTimeouts(): Promise<void> {
    const due = await this.timeoutService.pollDueTimeouts();
    for (const { callId, conversationId } of due) {
      await this.timeoutService.cancelTimeout(callId, conversationId);

      const state = await this.stateStore.get(conversationId);
      if (!state || state.call_id !== callId || state.status !== 'ringing') {
        continue;
      }

      this.logger.log(
        `Ring timeout fired: call=${callId} conversation=${conversationId}`,
      );

      const now = Date.now();
      const traceId = randomUUID();

      const timedOutEvent: CallTimedOutEvent = {
        call_id: callId,
        conversation_id: conversationId,
        timed_out_at: now,
        trace_id: traceId,
      };
      this.kafkaClient.emit(KafkaTopics.CallTimedOut, timedOutEvent);

      const endedEvent: CallEndedEvent = {
        call_id: callId,
        conversation_id: conversationId,
        user_id: state.initiator_id,
        reason: 'timeout',
        ended_at: now,
        trace_id: traceId,
      };
      this.kafkaClient.emit(KafkaTopics.CallEnded, endedEvent);

      state.status = 'ended';
      state.ended_at = now;
      await this.stateStore.clear(conversationId);
    }
  }
}
