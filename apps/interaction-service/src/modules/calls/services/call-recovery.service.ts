import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ClientKafka } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import {
  KafkaTopics,
  type CallEndedEvent,
  type CallStateSnapshot,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { RedisClientType } from 'redis';
import { CallStateStore } from '../utils/call-state.store';
import { CallHistoryService } from './call-history.service';

const RINGING_MAX_AGE_MS = 60_000; // 1 min — covers > 45s ring timeout
const ONGOING_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 h — generous upper bound

@Injectable()
export class CallRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CallRecoveryService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    private readonly stateStore: CallStateStore,
    private readonly callHistoryService: CallHistoryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(
        `Recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    let cursor = 0;
    let scanned = 0;
    let terminated = 0;

    do {
      const result = await this.redis.scan(cursor, {
        MATCH: 'call:state:conversation:*',
        COUNT: 100,
      });
      cursor = result.cursor;

      for (const key of result.keys) {
        scanned++;
        const conversationId = key.replace('call:state:conversation:', '');
        const state = await this.stateStore.get(conversationId);
        if (!state) continue;

        const age = now - state.started_at;
        const isOrphan =
          (state.status === 'ringing' && age > RINGING_MAX_AGE_MS) ||
          (state.status === 'ongoing' && age > ONGOING_MAX_AGE_MS);

        if (isOrphan) {
          await this.terminate(state, now);
          terminated++;
        }
      }
    } while (cursor !== 0);

    if (scanned > 0) {
      this.logger.log(
        `Recovery sweep: scanned=${scanned} terminated=${terminated}`,
      );
    }
  }

  private async terminate(
    state: CallStateSnapshot,
    endedAt: number,
  ): Promise<void> {
    const traceId = randomUUID();
    this.logger.warn(
      `Recovering orphan call=${state.call_id} status=${state.status} age=${endedAt - state.started_at}ms`,
    );

    const endedEvent: CallEndedEvent = {
      call_id: state.call_id,
      conversation_id: state.conversation_id,
      user_id: state.initiator_id,
      reason: 'recovered_orphan',
      ended_at: endedAt,
      conversation_type: state.conversation_type,
      initiator_id: state.initiator_id,
      participant_ids: Object.keys(state.participants),
      trace_id: traceId,
    };
    this.kafkaClient.emit(KafkaTopics.CallEnded, {
      key: state.conversation_id,
      value: endedEvent,
    });

    await this.stateStore.clear(state.conversation_id);
    await this.callHistoryService
      .closeSession(state.call_id, {
        endedAt,
        startedAt: state.started_at,
        reason: 'recovered_orphan',
      })
      .catch((err: Error) =>
        this.logger.error(
          `closeSession failed during recovery call=${state.call_id}: ${err.message}`,
          err.stack,
        ),
      );
  }
}
