import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallSession } from '@libs/database/entities';
import { CallType, CallSessionStatus, ConversationType } from '@app/constant';

const CALL_END_REASONS = {
  TIMEOUT: 'timeout',
  REJECTED: 'rejected',
  MISSED: 'missed',
} as const;

export interface CreateSessionPayload {
  id: string;
  conversationId: string;
  initiatorId: string;
  callType: CallType;
  conversationType: ConversationType;
  startedAt: number;
  participantIds: string[];
}

export interface CloseSessionPayload {
  endedAt: number;
  startedAt: number;
  reason?: string;
}

export interface PaginatedCallSessions {
  items: CallSession[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class CallHistoryService {
  private readonly logger = new Logger(CallHistoryService.name);

  constructor(
    @InjectRepository(CallSession)
    private readonly repo: Repository<CallSession>,
  ) {}

  async createSession(payload: CreateSessionPayload): Promise<void> {
    const session = this.repo.create({
      id: payload.id,
      conversationId: payload.conversationId,
      initiatorId: payload.initiatorId,
      callType: payload.callType,
      conversationType: payload.conversationType,
      startedAt: payload.startedAt,
      participantIds: payload.participantIds,
      status: CallSessionStatus.MISSED,
      endedAt: null,
      durationMs: null,
      reason: null,
    });
    await this.repo.save(session);
  }

  async closeSession(callId: string, payload: CloseSessionPayload): Promise<void> {
    const status = this.resolveStatus(payload.reason);
    const durationMs = Math.max(0, payload.endedAt - payload.startedAt);
    const result = await this.repo.update(
      { id: callId },
      {
        endedAt: payload.endedAt,
        durationMs,
        status,
        reason: payload.reason ?? null,
      },
    );
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(`closeSession: no call_session found for callId=${callId}`);
    }
  }

  async listForConversation(
    conversationId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedCallSessions> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const [items, total] = await this.repo.findAndCount({
      where: { conversationId },
      order: { startedAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return { items, total, page: safePage, limit: safeLimit };
  }

  private resolveStatus(reason?: string): CallSessionStatus {
    if (reason === CALL_END_REASONS.TIMEOUT) return CallSessionStatus.TIMEOUT;
    if (reason === CALL_END_REASONS.REJECTED) return CallSessionStatus.REJECTED;
    if (reason === CALL_END_REASONS.MISSED) return CallSessionStatus.MISSED;
    return CallSessionStatus.COMPLETED;
  }
}
