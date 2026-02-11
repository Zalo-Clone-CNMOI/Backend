import { Repository } from 'typeorm';
import { User, ConversationMember } from '@libs/database';

/**
 * Get all active member IDs for a conversation (excluding those who left)
 */
export async function getConversationMemberIds(
  conversationMemberRepo: Repository<ConversationMember>,
  conversationId: string,
): Promise<string[]> {
  const members = await conversationMemberRepo.find({
    where: {
      conversationId,
      leftAt: undefined, // Only active members
    },
    select: ['userId'],
  });

  return members.map((m) => m.userId);
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

  return user?.fullName ?? null;
}
