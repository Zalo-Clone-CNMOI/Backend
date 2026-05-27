import { Repository } from 'typeorm';
import { AppConfig } from '@libs/config';
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
import { CacheService } from '@libs/redis';
import { ClientKafka } from '@nestjs/microservices';
import { AiConversationFactoryService } from './ai-conversation-factory.service';
import { KafkaTopics, type AiConversationContext } from '@libs/contracts';

const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';

/**
 * Shared mock for the existing-conversation lookup QueryBuilder used by
 * both getOrCreateGeneral and getOrCreateDocumentConversation. Returns a
 * chainable stub whose getOne resolves to the supplied conversation.
 */
function makeLookupQueryBuilder(returnValue: Conversation | null) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(returnValue),
  };
}

describe('AiConversationFactoryService', () => {
  let service: AiConversationFactoryService;
  let entityManager: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let conversationRepo: jest.Mocked<Repository<Conversation>>;
  let memberRepo: jest.Mocked<Repository<ConversationMember>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let docMetaRepo: jest.Mocked<Repository<DocumentMetadata>>;
  let cacheService: jest.Mocked<CacheService>;
  let kafkaClient: jest.Mocked<ClientKafka>;

  beforeEach(() => {
    entityManager = {
      create: jest.fn((_: unknown, dto: unknown): unknown => dto),
      save: jest.fn((entity: unknown): Promise<unknown> => {
        if (Array.isArray(entity)) return Promise.resolve(entity);
        const obj = entity as Record<string, unknown>;
        if (!obj['id']) return Promise.resolve({ ...obj, id: 'conv-new' });
        return Promise.resolve(entity);
      }),
    };

    conversationRepo = {
      manager: {
        transaction: jest.fn(
          (
            cb: (em: typeof entityManager) => Promise<unknown>,
          ): Promise<unknown> => cb(entityManager),
        ),
      },
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<Conversation>>;

    memberRepo = {} as unknown as jest.Mocked<Repository<ConversationMember>>;

    userRepo = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { id: string; status?: string };
        }): Promise<User | null> => {
          const { id, status } = where;
          if (status === UserStatus.ACTIVE) {
            // Only return the user if they are not "nonexistent"
            if (id === 'nonexistent') return Promise.resolve(null);
            return Promise.resolve({ id, fullName: 'User' } as User);
          }
          return Promise.resolve(null);
        },
      ),
      findOneBy: jest.fn(({ id }: { id: string }): Promise<User | null> => {
        if (id === ZAI_ID)
          // Zai bot now seeded with UserStatus.SYSTEM (see migration
          // 1782200000000-set-zai-user-status-system.ts). The factory must
          // still locate it because it doesn't filter findOneBy by status.
          return Promise.resolve({
            id: ZAI_ID,
            fullName: 'Zai',
            status: UserStatus.SYSTEM,
          } as User);
        return Promise.resolve(null);
      }),
    } as unknown as jest.Mocked<Repository<User>>;

    docMetaRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<DocumentMetadata>>;

    cacheService = {
      setAiConversationContext: jest.fn().mockResolvedValue(undefined),
      deleteAiConversationContext: jest.fn().mockResolvedValue(undefined),
      invalidateConversation: jest.fn().mockResolvedValue(undefined),
      invalidateConversationList: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>;

    kafkaClient = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<ClientKafka>;

    service = new AiConversationFactoryService(
      conversationRepo,
      memberRepo,
      userRepo,
      docMetaRepo,
      { zaiBotUserId: ZAI_ID } as AppConfig,
      cacheService,
      kafkaClient,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('creates an AI_ASSISTANT conversation with user + Zai as members + stores AI context', async () => {
    const context: AiConversationContext = {
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1_700_000_000_000,
    };

    const result = await service.createZaiConversation('user-1', context);

    // Phase 4: stores full context as JSON instead of bare '1' marker
    expect(cacheService.setAiConversationContext).toHaveBeenCalledWith(
      'conv-new',
      context,
    );

    // Transaction was started
    expect(
      (conversationRepo.manager as unknown as { transaction: jest.Mock })
        .transaction,
    ).toHaveBeenCalledTimes(1);

    // Conversation entity created with correct shape
    expect(entityManager.create).toHaveBeenCalledWith(
      Conversation,
      expect.objectContaining({
        type: ConversationType.AI_ASSISTANT,
        aiContext: context,
        createdById: 'user-1',
      }),
    );

    // Member entities created for both participants
    expect(entityManager.create).toHaveBeenCalledWith(
      ConversationMember,
      expect.objectContaining({
        userId: 'user-1',
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );
    expect(entityManager.create).toHaveBeenCalledWith(
      ConversationMember,
      expect.objectContaining({
        userId: ZAI_ID,
        role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      }),
    );

    // em.save called twice: once for conversation, once for members array
    expect(entityManager.save).toHaveBeenCalledTimes(2);

    expect(result.id).toBe('conv-new');
  });

  it('rejects with BusinessException when user does not exist or is inactive', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.createZaiConversation('nonexistent', {
        feature: 'general',
        created_at: Date.now(),
      }),
    ).rejects.toThrow(BusinessException);

    // Transaction must NOT have been started
    expect(
      (conversationRepo.manager as unknown as { transaction: jest.Mock })
        .transaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects with BusinessException when Zai bot user is missing (migration not run)', async () => {
    userRepo.findOne.mockResolvedValueOnce({
      id: 'user-1',
      fullName: 'U',
    } as User);
    userRepo.findOneBy.mockResolvedValueOnce(null); // Zai missing

    await expect(
      service.createZaiConversation('user-1', {
        feature: 'general',
        created_at: Date.now(),
      }),
    ).rejects.toThrow(BusinessException);

    // Transaction must NOT have been started
    expect(
      (conversationRepo.manager as unknown as { transaction: jest.Mock })
        .transaction,
    ).not.toHaveBeenCalled();
  });

  it('throws BusinessException with NOT_FOUND error code when user is not found', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);

    const error = await service
      .createZaiConversation('nonexistent', {
        feature: 'general',
        created_at: Date.now(),
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BusinessException);
    // new BusinessException(ErrorCode.USER_NOT_FOUND) preserves the specific error code
    expect((error as BusinessException).errorCode).toBe(
      ErrorCode.USER_NOT_FOUND,
    );
  });

  // ── getOrCreateGeneral ───────────────────────────────────────────────────

  describe('getOrCreateGeneral', () => {
    it('returns existing conversation id without DB write when one exists', async () => {
      const existing = { id: 'conv-existing' } as Conversation;
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeLookupQueryBuilder(existing),
      );

      const result = await service.getOrCreateGeneral('user-1');

      expect(result).toEqual({ conversationId: 'conv-existing' });
      expect(entityManager.save).not.toHaveBeenCalled();
      expect(cacheService.setAiConversationContext).toHaveBeenCalledWith(
        'conv-existing',
        expect.objectContaining({ feature: 'general' }),
      );
    });

    it('creates new conversation when none exists and returns new id', async () => {
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeLookupQueryBuilder(null),
      );

      const result = await service.getOrCreateGeneral('user-1');

      expect(result).toEqual({ conversationId: 'conv-new' });
      expect(entityManager.save).toHaveBeenCalledTimes(2);
    });
  });

  // ── getOrCreateDocumentConversation (Phase 4 + S5 dedup) ─────────────────

  describe('getOrCreateDocumentConversation', () => {
    it('creates a feature=document conversation when none exists', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce({
        id: 'doc-1',
        userId: 'user-1',
      } as DocumentMetadata);
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeLookupQueryBuilder(null),
      );

      const result = await service.getOrCreateDocumentConversation(
        'user-1',
        'doc-1',
      );

      expect(docMetaRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'doc-1', userId: 'user-1' },
      });
      expect(result).toEqual({ conversationId: 'conv-new' });
      expect(cacheService.setAiConversationContext).toHaveBeenCalledWith(
        'conv-new',
        expect.objectContaining({
          feature: 'document',
          document_id: 'doc-1',
        }),
      );
    });

    it('returns existing conversation id without DB write when one exists for (userId, documentId)', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce({
        id: 'doc-1',
        userId: 'user-1',
      } as DocumentMetadata);
      const existing = {
        id: 'conv-doc-existing',
        aiContext: {
          feature: 'document',
          document_id: 'doc-1',
          created_at: 1,
        },
      } as Conversation;
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeLookupQueryBuilder(existing),
      );

      const result = await service.getOrCreateDocumentConversation(
        'user-1',
        'doc-1',
      );

      expect(result).toEqual({ conversationId: 'conv-doc-existing' });
      // No new conversation written
      expect(entityManager.save).not.toHaveBeenCalled();
      // Redis context re-set for idempotency (carries existing aiContext)
      expect(cacheService.setAiConversationContext).toHaveBeenCalledWith(
        'conv-doc-existing',
        expect.objectContaining({
          feature: 'document',
          document_id: 'doc-1',
        }),
      );
    });

    it('throws BusinessException(NOT_FOUND) when document not owned by user', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce(null);

      const err = await service
        .getOrCreateDocumentConversation('user-1', 'doc-1')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).errorCode).toBe(ErrorCode.NOT_FOUND);
      // No conversation created — neither dedup query nor save runs
      expect(conversationRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(entityManager.save).not.toHaveBeenCalled();
    });
  });

  // ── disbandAiConversation (Phase 6 C11) ──────────────────────────────────

  describe('disbandAiConversation', () => {
    function setupTransaction(
      conversation: Conversation | null,
      activeMembers: ConversationMember[],
    ) {
      const convTxRepo = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(conversation),
        }),
        save: jest.fn().mockImplementation((c: unknown) => Promise.resolve(c)),
      };
      const memberTxRepo = {
        find: jest.fn().mockResolvedValue(activeMembers),
        save: jest.fn().mockResolvedValue(activeMembers),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === Conversation ? convTxRepo : memberTxRepo,
        ),
      };
      (
        conversationRepo.manager as unknown as { transaction: jest.Mock }
      ).transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );
      return { convTxRepo, memberTxRepo };
    }

    it('soft-deletes members, deletes the Redis marker, emits ConversationDisbanded, invalidates caches', async () => {
      const conversation = {
        id: 'conv-ai',
        type: ConversationType.AI_ASSISTANT,
        createdById: 'user-1',
      } as Conversation;
      const members = [
        {
          conversationId: 'conv-ai',
          userId: 'user-1',
          leftAt: null,
        } as ConversationMember,
        {
          conversationId: 'conv-ai',
          userId: ZAI_ID,
          leftAt: null,
        } as ConversationMember,
      ];
      const { memberTxRepo } = setupTransaction(conversation, members);

      const result = await service.disbandAiConversation('user-1', 'conv-ai');

      expect(result).toEqual({
        message: 'AI conversation disbanded successfully',
      });
      expect(members[0].leftAt).toBeInstanceOf(Date);
      expect(members[1].leftAt).toBeInstanceOf(Date);
      expect(memberTxRepo.save).toHaveBeenCalled();
      expect(cacheService.deleteAiConversationContext).toHaveBeenCalledWith(
        'conv-ai',
      );
      expect(kafkaClient.emit).toHaveBeenCalledWith(
        KafkaTopics.ConversationDisbanded,
        expect.objectContaining({
          conversation_id: 'conv-ai',
          disbanded_by: 'user-1',
          member_ids: ['user-1', ZAI_ID],
        }),
      );
      expect(cacheService.invalidateConversation).toHaveBeenCalledWith(
        'conv-ai',
        ['user-1', ZAI_ID],
      );
    });

    it('rejects a non-AI conversation with CONVERSATION_INVALID_TYPE', async () => {
      const conversation = {
        id: 'conv-grp',
        type: ConversationType.GROUP,
        createdById: 'user-1',
      } as Conversation;
      setupTransaction(conversation, []);

      const err = await service
        .disbandAiConversation('user-1', 'conv-grp')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BusinessException);
      // disbandAiConversationCore uses BusinessException.badRequest, which maps
      // to the generic BAD_REQUEST code (mirrors the GROUP disband path).
      expect((err as BusinessException).errorCode).toBe(ErrorCode.BAD_REQUEST);
      expect(cacheService.deleteAiConversationContext).not.toHaveBeenCalled();
      expect(kafkaClient.emit).not.toHaveBeenCalled();
    });

    it('rejects a non-creator with CONVERSATION_PERMISSION_DENIED', async () => {
      const conversation = {
        id: 'conv-ai',
        type: ConversationType.AI_ASSISTANT,
        createdById: 'someone-else',
      } as Conversation;
      setupTransaction(conversation, []);

      const err = await service
        .disbandAiConversation('user-1', 'conv-ai')
        .catch((e: unknown) => e);

      expect((err as BusinessException).errorCode).toBe(ErrorCode.FORBIDDEN);
      expect(cacheService.deleteAiConversationContext).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the conversation does not exist', async () => {
      setupTransaction(null, []);

      const err = await service
        .disbandAiConversation('user-1', 'missing')
        .catch((e: unknown) => e);

      expect((err as BusinessException).errorCode).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
