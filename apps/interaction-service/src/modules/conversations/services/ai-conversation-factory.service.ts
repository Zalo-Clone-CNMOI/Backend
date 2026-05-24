import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import {
  Conversation,
  ConversationMember,
  User,
} from '@libs/database/entities';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';
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
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const zai = await this.userRepository.findOneBy({
      id: this.config.zaiBotUserId,
    });
    if (!zai) {
      throw new Error(
        `Zai bot user not seeded — run migration AddZaiFoundation`,
      );
    }

    const conversation = this.conversationRepository.create({
      type: ConversationType.AI_ASSISTANT,
      name: null,
      avatarUrl: null,
      createdById: userId,
      settings: null,
      aiContext: context,
    });
    const saved = await this.conversationRepository.save(conversation);

    const members = [
      this.memberRepository.create({
        conversationId: saved.id,
        userId,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
      this.memberRepository.create({
        conversationId: saved.id,
        userId: this.config.zaiBotUserId,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    ];
    await this.memberRepository.save(members);

    this.logger.log(
      `Created Zai conversation ${saved.id} for user ${userId} (feature: ${context.feature})`,
    );
    return saved;
  }
}
