import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallSession } from '@libs/database/entities';
import { CallType, CallSessionStatus, ConversationType } from '@app/constant';

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

@Injectable()
export class CallHistoryService {
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
    await this.repo.update(
      { id: callId },
      {
        endedAt: payload.endedAt,
        durationMs,
        status,
        reason: payload.reason ?? null,
      },
    );
  }

  async listForConversation(conversationId: string, page: number, limit: number) {
    const [items, total] = await this.repo.findAndCount({
      where: { conversationId },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  private resolveStatus(reason?: string): CallSessionStatus {
    if (reason === 'timeout') return CallSessionStatus.TIMEOUT;
    if (reason === 'rejected') return CallSessionStatus.REJECTED;
    if (reason === 'missed') return CallSessionStatus.MISSED;
    return CallSessionStatus.COMPLETED;
  }
}
