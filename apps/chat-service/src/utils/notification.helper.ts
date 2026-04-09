import { IsNull, Repository } from 'typeorm';
import { User, ConversationMember } from '@libs/database';

/**
 * Get all active member IDs for a conversation (excluding those who left)
 */
export async function getConversationMemberIds(
  conversationMemberRepo: Repository<ConversationMember>,
  conversationId: string,
): Promise<string[]> {
  const members =
    (await conversationMemberRepo.find({
      where: {
        conversationId,
        leftAt: IsNull(),
      },
      select: ['userId'],
    })) ?? [];

  if (!Array.isArray(members)) {
    return [];
  }

  return members
    .map((m) => m.userId)
    .filter((userId): userId is string => Boolean(userId));
}

/**
 * Get user's display name for notification titles
 */
export async function getUserDisplayName(
  userRepo: Repository<User>,
  userId: string,
): Promise<string | null> {
  const user = await userRepo.findOne({
    where: { id: userId },
    select: ['fullName'],
  });

  return user?.fullName ?? 'Unknown User';
}
