import { IsNull, type EntityManager, type Repository } from 'typeorm';
import type {
  ConversationMember,
  ConversationPollOption,
  ConversationPollVote,
} from '@libs/database/entities';
import {
  NotificationType,
  type NotificationRequestedEvent,
} from '@libs/contracts';
import { ErrorCode } from '@app/constant';
import { BusinessException } from '@app/types';

export function isUniqueViolationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const anyErr = err as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  if (anyErr.code === '23505') {
    return true;
  }
  if (anyErr.driverError && anyErr.driverError.code === '23505') {
    return true;
  }
  return false;
}

export function buildPollMemberNotifications(
  members: ConversationMember[],
  args: {
    conversationId: string;
    excludeUserId: string | null;
    pollId: string;
    title: string;
    body: string;
    notificationType: NotificationType;
    category: string;
    traceIdPrefix: string;
  },
): NotificationRequestedEvent[] {
  const recipientIds = members
    .map((m) => m.userId)
    .filter((id) => !!id && id !== args.excludeUserId);

  if (recipientIds.length === 0) {
    return [];
  }

  const requestedAt = Date.now();
  return recipientIds.map<NotificationRequestedEvent>((recipientId) => ({
    channel: 'push',
    user_id: recipientId,
    title: args.title,
    body: args.body,
    type: args.notificationType,
    data: {
      poll_id: args.pollId,
      conversation_id: args.conversationId,
    },
    rich: {
      priority: 'normal',
      category: args.category,
      thread_id: args.conversationId,
    },
    requested_at: requestedAt,
    trace_id: `${args.traceIdPrefix}:${recipientId}`,
  }));
}

export async function loadPollTally(
  manager: EntityManager,
  pollId: string,
): Promise<Map<string, number>> {
  const rows = await manager
    .createQueryBuilder()
    .select('option_id', 'option_id')
    .addSelect('COUNT(*)', 'count')
    .from('conversation_poll_votes', 'v')
    .where('v.poll_id = :pid', { pid: pollId })
    .groupBy('option_id')
    .getRawMany<{ option_id: string; count: string }>();
  return new Map(rows.map((r) => [r.option_id, Number(r.count)]));
}

export function parseExpiresAt(
  expiresAt: string | null | undefined,
): Date | null | undefined {
  if (expiresAt === undefined) {
    return undefined;
  }
  if (expiresAt === null) {
    return null;
  }
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new BusinessException(
      ErrorCode.POLL_EXPIRES_AT_IN_PAST,
      ErrorCode.POLL_EXPIRES_AT_IN_PAST,
    );
  }
  return parsed;
}

export async function validateOptionLabelEdits(
  optionRepo: Repository<ConversationPollOption>,
  voteRepo: Repository<ConversationPollVote>,
  pollId: string,
  edits: Array<{ option_id: string; label: string }> | undefined | null,
): Promise<Array<{ option_id: string; label: string }>> {
  if (!Array.isArray(edits) || edits.length === 0) {
    return [];
  }
  const result: Array<{ option_id: string; label: string }> = [];
  for (const edit of edits) {
    const trimmedLabel = (edit?.label ?? '').trim();
    const option = await optionRepo.findOne({
      where: {
        id: edit.option_id,
        pollId,
        deletedAt: IsNull() as unknown as Date,
      },
    });
    if (!option) {
      throw new BusinessException(
        ErrorCode.POLL_INVALID_OPTION,
        ErrorCode.POLL_INVALID_OPTION,
      );
    }
    const optionVotes = await voteRepo.count({
      where: { pollId, optionId: edit.option_id },
    });
    if (optionVotes > 0) {
      throw new BusinessException(
        ErrorCode.POLL_CANNOT_EDIT_OPTION_WITH_VOTES,
        ErrorCode.POLL_CANNOT_EDIT_OPTION_WITH_VOTES,
      );
    }
    result.push({ option_id: edit.option_id, label: trimmedLabel });
  }
  return result;
}
