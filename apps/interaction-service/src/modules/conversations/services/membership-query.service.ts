import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Conversation, ConversationMember } from '@libs/database/entities';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';
import type { MembershipEntryDto } from '../dto';

/**
 * Read-only membership queries that ws-gateway used to run in-process via
 * @libs/mvp-access (which needed a TypeORM DataSource). ws-gateway is now a
 * stateless transport layer, so it calls these over internal HTTP instead.
 *
 * This service deliberately holds NO cache — ws-gateway keeps the short-TTL
 * caches and request batching on its side (same TTLs as before). Here we just
 * answer freshly from the DB. Logic is a faithful port of the queries in
 * libs/mvp-access/src/membership.ts so behavior is unchanged.
 */
@Injectable()
export class MembershipQueryService {
  constructor(
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  /**
   * Port of ConversationMembershipService.queryAccessMap.
   * For each requested conversation id, returns whether the user is an active
   * member and (if so) the conversation type — co-located so ws-gateway fills
   * both its access decision and type cache from a single roundtrip.
   */
  async getMembershipBatch(
    userId: string,
    conversationIds: string[],
  ): Promise<MembershipEntryDto[]> {
    if (conversationIds.length === 0) return [];

    const deduped = Array.from(new Set(conversationIds));
    const memberships = await this.memberRepository.find({
      where: {
        userId,
        conversationId: In(deduped),
        leftAt: IsNull(),
      },
      relations: ['conversation'],
      select: {
        conversationId: true,
        conversation: { id: true, type: true },
      },
    });

    const lookup = new Map<
      string,
      { allowed: boolean; conversationType: ConversationType | null }
    >();
    for (const m of memberships) {
      lookup.set(m.conversationId, {
        allowed: true,
        conversationType: m.conversation?.type ?? null,
      });
    }

    return conversationIds.map((id) => {
      const entry = lookup.get(id) ?? {
        allowed: false,
        conversationType: null,
      };
      return {
        conversation_id: id,
        allowed: entry.allowed,
        conversation_type: entry.conversationType,
      };
    });
  }

  /**
   * Port of ConversationMembershipService.canUserSendMessage (server side).
   * No caching here — ws-gateway caches the result. Returns the final decision
   * including the role-privilege fallback when send_message is disabled.
   */
  async getSendPermission(
    userId: string,
    conversationId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1) Must be an active member at all.
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
      select: ['role'],
    });
    if (!membership) {
      return { allowed: false, reason: 'not_member' };
    }

    // 2) Direct conversations (or missing conversation) always allow sending.
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      select: ['type', 'settings'],
    });
    if (!conversation || conversation.type !== ConversationType.GROUP) {
      return { allowed: true };
    }

    // 3) Group with send_message enabled → allowed.
    const sendMessage =
      conversation.settings?.permissions?.send_message ?? true;
    if (sendMessage) {
      return { allowed: true };
    }

    // 4) send_message disabled — only OWNER/ADMIN may send.
    const isPrivileged =
      membership.role === UpdateMemberRoleDtoRoleEnum.OWNER ||
      membership.role === UpdateMemberRoleDtoRoleEnum.ADMIN;
    return isPrivileged
      ? { allowed: true }
      : { allowed: false, reason: 'send_permission_denied' };
  }

  /**
   * Port of ConversationMembershipService.listActiveMemberIds.
   */
  async listActiveMemberIds(conversationId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: { conversationId, leftAt: IsNull() },
      select: ['userId'],
    });
    return memberships.map((m) => m.userId);
  }
}
