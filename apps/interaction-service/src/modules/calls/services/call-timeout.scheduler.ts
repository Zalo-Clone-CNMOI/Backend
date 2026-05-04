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
import { CallTimeoutService, type DueTimeout } from './call-timeout.service';
import { CallStateStore } from '../utils/call-state.store';
import { CallStateLock } from '../utils/call-state.lock';
import { CallHistoryService } from './call-history.service';

@Injectable()
export class CallTimeoutScheduler {
  private readonly logger = new Logger(CallTimeoutScheduler.name);

  constructor(
    private readonly timeoutService: CallTimeoutService,
    private readonly stateStore: CallStateStore,
    private readonly stateLock: CallStateLock,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly callHistoryService: CallHistoryService,
  ) {}

  @Interval(5000)
  async checkTimeouts(): Promise<void> {
    let due: DueTimeout[] = [];
    try {
      due = await this.timeoutService.popDueTimeouts();
    } catch (err) {
      this.logger.error(
        `Failed to pop due timeouts: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return;
    }

    for (const { callId, conversationId } of due) {
      try {
        await this.processOneTimeout(callId, conversationId);
      } catch (err) {
        this.logger.error(
          `Timeout processing failed call=${callId}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  private async processOneTimeout(
    callId: string,
    conversationId: string,
  ): Promise<void> {
    await this.stateLock.withLock(conversationId, async () => {
      await this.timeoutInternal(callId, conversationId);
    });
  }

  private async timeoutInternal(
    callId: string,
    conversationId: string,
  ): Promise<void> {
    const state = await this.stateStore.get(conversationId);
    if (!state || state.call_id !== callId || state.status !== 'ringing') {
      return;
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
    this.kafkaClient.emit(KafkaTopics.CallTimedOut, {
      key: conversationId,
      value: timedOutEvent,
    });

    const endedEvent: CallEndedEvent = {
      call_id: callId,
      conversation_id: conversationId,
      user_id: state.initiator_id,
      reason: 'timeout',
      ended_at: now,
      conversation_type: state.conversation_type,
      initiator_id: state.initiator_id,
      participant_ids: Object.keys(state.participants),
      trace_id: traceId,
    };
    this.kafkaClient.emit(KafkaTopics.CallEnded, {
      key: conversationId,
      value: endedEvent,
    });

    this.logger.log(`Clearing call state for timed-out call=${callId}`);
    await this.stateStore.clear(conversationId);

    this.callHistoryService
      .closeSession(callId, {
        endedAt: now,
        startedAt: state.started_at,
        reason: 'timeout',
      })
      .catch((err: Error) =>
        this.logger.error(
          `closeSession failed for timed-out call=${callId}: ${err.message}`,
          err.stack,
        ),
      );
  }
}
