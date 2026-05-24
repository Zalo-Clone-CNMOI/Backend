import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import {
  Conversation,
  ConversationMember,
  User,
} from '@libs/database/entities';
import {
  ConversationType,
  ErrorCode,
  UpdateMemberRoleDtoRoleEnum,
  UserStatus,
} from '@app/constant';
import { BusinessException } from '@app/types';
import type { AiConversationContext } from '@libs/contracts';

/**
 * Creates a one-to-one AI_ASSISTANT conversation between a user and the Zai
 * bot. Internal service — not exposed to controllers. Phase 2-3 feature
 * triggers (e.g., document upload → AI chat) call this.
 */
@Injectable()
export class AiConversationFactoryService {
  private readonly logger = new Logger(AiConversationFactoryService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async createZaiConversation(
    userId: string,
    context: AiConversationContext,
  ): Promise<Conversation> {
    // Validation — no DB writes yet
    const user = await this.userRepository.findOne({
      where: { id: userId, status: UserStatus.ACTIVE },
    });
    if (!user) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const zai = await this.userRepository.findOneBy({
      id: this.config.zaiBotUserId,
    });
    if (!zai) {
      throw BusinessException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    // Atomic write — conversation + members together
    return this.conversationRepository.manager.transaction(async (em) => {
      const conversation = em.create(Conversation, {
        type: ConversationType.AI_ASSISTANT,
        name: null,
        avatarUrl: null,
        createdById: userId,
        settings: null,
        aiContext: context,
      });
      const saved = await em.save(conversation);

      const members = [
        em.create(ConversationMember, {
          conversationId: saved.id,
          userId,
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        }),
        em.create(ConversationMember, {
          conversationId: saved.id,
          userId: this.config.zaiBotUserId,
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        }),
      ];
      await em.save(members);

      this.logger.log(
        `Created Zai conversation ${saved.id} for user ${userId} (feature: ${context.feature})`,
      );
      return saved;
    });
  }
}
