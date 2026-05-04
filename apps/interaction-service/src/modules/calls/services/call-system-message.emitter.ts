import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientKafka } from '@nestjs/microservices';
import {
  KafkaTopics,
  SystemEventType,
  type CallEndedMetadata,
  type CallMissedMetadata,
  type CallStateSnapshot,
  type CallType,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { SystemMessageFactory } from '@libs/shared';

export interface CallTerminationContext {
  state: CallStateSnapshot;
  endedAt: number;
  /** True only when state.status was 'ongoing' before termination. */
  wasAnswered: boolean;
  reason?: string;
  /** Override duration; today only used for reject-before-answer (always 0). */
  forceDurationMs?: number;
  traceId?: string;
}

@Injectable()
export class CallSystemMessageEmitter {
  private readonly logger = new Logger(CallSystemMessageEmitter.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  publish(ctx: CallTerminationContext): void {
    const systemMsg = ctx.wasAnswered
      ? this.buildEnded(ctx)
      : this.buildMissed(ctx);

    try {
      this.kafkaClient
        .emit(KafkaTopics.ChatSystemMessageCreated, systemMsg)
        .subscribe({
          error: (err: unknown) =>
            this.logger.error(
              `Async publish failed for call system message call=${ctx.state.call_id}: ${err instanceof Error ? err.message : String(err)}`,
              err instanceof Error ? err.stack : undefined,
            ),
        });
    } catch (err) {
      this.logger.error(
        `Sync publish threw for call system message call=${ctx.state.call_id}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private buildEnded(ctx: CallTerminationContext) {
    const { state, endedAt, traceId } = ctx;
    const durationMs = Math.max(0, endedAt - state.started_at);
    const metadata: CallEndedMetadata = {
      call_id: state.call_id,
      call_type: state.call_type,
      initiator_id: state.initiator_id,
      duration_ms: durationMs,
      started_at: state.started_at,
      ended_at: endedAt,
    };
    return SystemMessageFactory.create({
      conversationId: state.conversation_id,
      systemEventType: SystemEventType.CALL_ENDED,
      metadata,
      traceId: traceId ?? `system-msg:call-ended:${state.call_id}`,
      bodyFallback: this.formatEndedBody(state.call_type, durationMs),
      messageId: `call-ended:${state.call_id}`,
    });
  }

  private buildMissed(ctx: CallTerminationContext) {
    const { state, endedAt, reason, traceId } = ctx;
    const metadata: CallMissedMetadata = {
      call_id: state.call_id,
      call_type: state.call_type,
      initiator_id: state.initiator_id,
      reason: this.normalizeMissedReason(reason),
      started_at: state.started_at,
      ended_at: endedAt,
    };
    return SystemMessageFactory.create({
      conversationId: state.conversation_id,
      systemEventType: SystemEventType.CALL_MISSED,
      metadata,
      traceId: traceId ?? `system-msg:call-missed:${state.call_id}`,
      bodyFallback: this.formatMissedBody(state.call_type),
      messageId: `call-missed:${state.call_id}`,
    });
  }

  private formatEndedBody(callType: CallType, durationMs: number): string {
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const label = callType === 'audio' ? 'Cuộc gọi thoại' : 'Cuộc gọi video';
    return `${label} - ${minutes} phút ${seconds} giây`;
  }

  private formatMissedBody(callType: CallType): string {
    const label = callType === 'audio' ? 'Cuộc gọi thoại' : 'Cuộc gọi video';
    return `${label} nhỡ`;
  }

  private normalizeMissedReason(
    reason: string | undefined,
  ): 'timeout' | 'rejected' | 'missed' {
    if (reason === 'timeout' || reason === 'rejected') return reason;
    return 'missed';
  }
}
