import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  Conversation,
  ConversationMember,
  DocumentMetadata,
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
import { CacheService } from '@libs/redis';
import { disbandAiConversationCore } from './conversation-member.helpers';

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
    @InjectRepository(DocumentMetadata)
    private readonly documentMetadataRepository: Repository<DocumentMetadata>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cacheService: CacheService,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  /**
   * Disband (delete) an AI_ASSISTANT conversation owned by `userId`. Rejects
   * non-AI conversations and non-creators. Soft-deletes the user + Zai
   * memberships, drops the Redis routing marker, and emits ConversationDisbanded.
   */
  async disbandAiConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return disbandAiConversationCore(
      {
        conversationRepository: this.conversationRepository,
        kafkaClient: this.kafkaClient,
        cacheService: this.cacheService,
      },
      userId,
      conversationId,
    );
  }

  async createZaiConversation(
    userId: string,
    context: AiConversationContext,
  ): Promise<Conversation> {
    // Validation — no DB writes yet
    const user = await this.userRepository.findOne({
      where: { id: userId, status: UserStatus.ACTIVE },
    });
    if (!user) {
      throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    }

    const zai = await this.userRepository.findOneBy({
      id: this.config.zaiBotUserId,
    });
    if (!zai) {
      throw new BusinessException(
        ErrorCode.USER_NOT_FOUND,
        'Zai bot user not seeded — run migration AddZaiFoundation',
      );
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

      // Store AI context in Redis so chat-service can route messages without a DB lookup.
      // Awaited here: if the marker is missing, chat-service won't route AI messages
      // for this conversation until the user calls getOrCreateGeneral again.
      await this.cacheService.setAiConversationContext(saved.id, context);

      return saved;
    });
  }

  // TODO(Phase-3-follow-up): add a partial unique index on conversations
  // (created_by_id) WHERE type='AI_ASSISTANT' AND ai_context->>'feature'='general'
  // to prevent duplicate conversations under concurrent first-use requests.
  async getOrCreateGeneral(
    userId: string,
  ): Promise<{ conversationId: string }> {
    const existing = await this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.members', 'm', 'm.userId = :userId AND m.leftAt IS NULL', {
        userId,
      })
      .where("c.type = :type AND c.aiContext->>'feature' = :feature", {
        type: ConversationType.AI_ASSISTANT,
        feature: 'general',
      })
      .getOne();

    if (existing) {
      // Ensure context exists in Redis (idempotent re-set).
      void this.cacheService.setAiConversationContext(
        existing.id,
        existing.aiContext ?? { feature: 'general', created_at: 0 },
      );
      return { conversationId: existing.id };
    }

    const conv = await this.createZaiConversation(userId, {
      feature: 'general',
      created_at: Date.now(),
    });
    return { conversationId: conv.id };
  }

  // TODO(Phase-5-follow-up): add a partial unique index on conversations
  // (created_by_id, ai_context->>'document_id') WHERE type='AI_ASSISTANT'
  // AND ai_context->>'feature'='document' to close the 2-concurrent-request
  // race window. The dedup query below covers the common single-request case.
  async getOrCreateDocumentConversation(
    userId: string,
    documentId: string,
  ): Promise<{ conversationId: string }> {
    // 1. Verify document exists AND is owned by the requesting user.
    const doc = await this.documentMetadataRepository.findOne({
      where: { id: documentId, userId },
    });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Document not found or access denied',
      );
    }

    // 2. Look up existing AI_ASSISTANT conversation for (userId, documentId).
    //    Idempotent — repeated "Analyze document" clicks return the same id.
    const existing = await this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.members', 'm', 'm.userId = :userId AND m.leftAt IS NULL', {
        userId,
      })
      .where(
        "c.type = :type AND c.aiContext->>'feature' = :feature AND c.aiContext->>'document_id' = :documentId",
        {
          type: ConversationType.AI_ASSISTANT,
          feature: 'document',
          documentId,
        },
      )
      .getOne();

    if (existing) {
      // Ensure context exists in Redis (idempotent re-set).
      void this.cacheService.setAiConversationContext(
        existing.id,
        existing.aiContext ?? {
          feature: 'document',
          document_id: documentId,
          created_at: 0,
        },
      );
      return { conversationId: existing.id };
    }

    // 3. Otherwise create a new conversation anchored to this document.
    const conv = await this.createZaiConversation(userId, {
      feature: 'document',
      document_id: documentId,
      created_at: Date.now(),
    });
    return { conversationId: conv.id };
  }
}
