import { Repository } from 'typeorm';
import { AppConfig } from '@libs/config';
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

    service = new AiConversationFactoryService(
      conversationRepo,
      memberRepo,
      userRepo,
      { zaiBotUserId: ZAI_ID } as AppConfig,
    );
  });

  it('creates an AI_ASSISTANT conversation with user + Zai as members', async () => {
    const context: AiConversationContext = {
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1_700_000_000_000,
    };

    const result = await service.createZaiConversation('user-1', context);

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
});
