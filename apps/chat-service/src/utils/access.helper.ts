import { LoggerService } from '@nestjs/common';
import { ConversationMembershipService } from '@libs/mvp-access';
import { MessageRepository } from '@libs/scylla';

interface EnsureConversationAccessParams {
  membershipService: ConversationMembershipService;
  logger: LoggerService;
  traceId: string;
  senderId: string;
  conversationId: string;
  action: 'message' | 'edit' | 'delete';
  messageId?: string;
}

/**
 * Shared authorization guard for chat message commands.
 */
export async function ensureConversationAccess({
  membershipService,
  logger,
  traceId,
  senderId,
  conversationId,
  action,
  messageId,
}: EnsureConversationAccessParams): Promise<boolean> {
  const hasAccess = await membershipService.canUserAccessConversation(
    senderId,
    conversationId,
  );

  if (hasAccess) {
    return true;
  }

  logger.warn(`[${traceId}] Unauthorized ${action} attempt`, {
    ...(messageId ? { messageId } : {}),
    senderId,
    conversationId,
    reason: 'not_member',
  });

  return false;
}

interface EnsureMessageOwnershipParams {
  repo: MessageRepository;
  logger: LoggerService;
  traceId: string;
  senderId: string;
  conversationId: string;
  createdAt: number;
  messageId: string;
  action: 'edit' | 'delete';
}

/**
 * Shared ownership guard for mutation commands.
 */
export async function ensureMessageOwnership({
  repo,
  logger,
  traceId,
  senderId,
  conversationId,
  createdAt,
  messageId,
  action,
}: EnsureMessageOwnershipParams): Promise<boolean> {
  const existingMessage = await repo.getMessage(
    conversationId,
    createdAt,
    messageId,
  );

  if (!existingMessage) {
    logger.warn(`[${traceId}] ${action} target message not found`, {
      messageId,
      conversationId,
    });
    return false;
  }

  if (existingMessage.sender_id !== senderId) {
    logger.warn(`[${traceId}] Unauthorized ${action} attempt`, {
      messageId,
      senderId,
      ownerId: existingMessage.sender_id,
      conversationId,
      reason: 'not_owner',
    });
    return false;
  }

  return true;
}
