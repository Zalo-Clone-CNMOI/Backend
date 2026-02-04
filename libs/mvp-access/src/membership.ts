import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConversationMember } from '@libs/database/entities';

@Injectable()
export class ConversationMembershipService {
  constructor(
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
  ) {}

  /**
   * Check if a user has access to a conversation
   * User has access if they are an active member (leftAt is null)
   */
  async canUserAccessConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const member = await this.memberRepository.findOne({
      where: {
        userId,
        conversationId,
        leftAt: IsNull(),
      },
    });

    return member !== null;
  }

  /**
   * List all conversations for a user
   * Returns only active memberships (leftAt is null)
   */
  async listConversationsForUser(userId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: {
        userId,
        leftAt: IsNull(),
      },
      select: ['conversationId'],
    });

    return memberships.map((m) => m.conversationId);
  }

  /**
   * Batch check user access for multiple conversations
   * More efficient than calling canUserAccessConversation multiple times
   */
  async canUserAccessConversations(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, boolean>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const memberships = await this.memberRepository.find({
      where: {
        userId,
        leftAt: IsNull(),
      },
      select: ['conversationId'],
    });

    const accessibleConversations = new Set(
      memberships.map((m) => m.conversationId),
    );

    return new Map(
      conversationIds.map((id) => [id, accessibleConversations.has(id)]),
    );
  }
}

export function canUserAccessConversation(): boolean {
  console.warn(
    'DEPRECATED: canUserAccessConversation() function uses hardcoded data. ' +
      'Use ConversationMembershipService.canUserAccessConversation() instead.',
  );
  return false;
}

export function listConversationsForUser(): string[] {
  console.warn(
    'DEPRECATED: listConversationsForUser() function uses hardcoded data. ' +
      'Use ConversationMembershipService.listConversationsForUser() instead.',
  );
  return [];
}
