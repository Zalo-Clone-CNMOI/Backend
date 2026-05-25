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
import { AiConversationFactoryService } from './ai-conversation-factory.service';
import type { AiConversationContext } from '@libs/contracts';

const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';

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
          return Promise.resolve({ id: ZAI_ID, fullName: 'Zai' } as User);
        return Promise.resolve(null);
      }),
    } as unknown as jest.Mocked<Repository<User>>;

    docMetaRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<DocumentMetadata>>;

    cacheService = {
      setAiConversationMarker: jest.fn().mockResolvedValue(undefined),
      setAiConversationContext: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>;

    service = new AiConversationFactoryService(
      conversationRepo,
      memberRepo,
      userRepo,
      docMetaRepo,
      { zaiBotUserId: ZAI_ID } as AppConfig,
      cacheService,
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
    function makeQueryBuilder(returnValue: Conversation | null) {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(returnValue),
      };
      return qb;
    }

    it('returns existing conversation id without DB write when one exists', async () => {
      const existing = { id: 'conv-existing' } as Conversation;
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQueryBuilder(existing),
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
        makeQueryBuilder(null),
      );

      const result = await service.getOrCreateGeneral('user-1');

      expect(result).toEqual({ conversationId: 'conv-new' });
      expect(entityManager.save).toHaveBeenCalledTimes(2);
    });
  });

  // ── getOrCreateDocumentConversation (Phase 4 + S5 dedup) ─────────────────

  describe('getOrCreateDocumentConversation', () => {
    function makeDocQueryBuilder(returnValue: Conversation | null) {
      return {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(returnValue),
      };
    }

    it('creates a feature=document conversation when none exists', async () => {
      docMetaRepo.findOne.mockResolvedValueOnce({
        id: 'doc-1',
        userId: 'user-1',
      } as DocumentMetadata);
      (conversationRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeDocQueryBuilder(null),
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
        makeDocQueryBuilder(existing),
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
});
