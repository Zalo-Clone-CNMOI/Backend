type ConversationId = string;
type UserId = string;

// MVP hardcode: replace with Relationship Service later.
const conversationMembers: Record<ConversationId, UserId[]> = {
  // Example conversation with two users
  '00000000-0000-0000-0000-000000000001': ['user-a', 'user-b'],
};

export function canUserAccessConversation(
  userId: string,
  conversationId: string,
): boolean {
  const members = conversationMembers[conversationId] ?? [];
  return members.includes(userId);
}

export function listConversationsForUser(userId: string): string[] {
  return Object.entries(conversationMembers)
    .filter(([, members]) => members.includes(userId))
    .map(([conversationId]) => conversationId);
}
