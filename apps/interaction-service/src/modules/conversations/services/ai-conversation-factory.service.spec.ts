import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import {
  Conversation,
  ConversationMember,
  User,
} from '@libs/database/entities';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';
import { AiConversationFactoryService } from './ai-conversation-factory.service';
import type { AiConversationContext } from '@libs/contracts';

const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';

describe('AiConversationFactoryService', () => {
  let service: AiConversationFactoryService;
  let conversationRepo: jest.Mocked<Repository<Conversation>>;
  let memberRepo: jest.Mocked<Repository<ConversationMember>>;
  let userRepo: jest.Mocked<Repository<User>>;

  beforeEach(() => {
    conversationRepo = {
      create: jest.fn((x) => x as Conversation),
      save: jest.fn(async (x: Conversation) => ({ ...x, id: 'conv-new' })),
    } as unknown as jest.Mocked<Repository<Conversation>>;

    memberRepo = {
      create: jest.fn((x) => x as ConversationMember),
      save: jest.fn(async (xs: ConversationMember[]) => xs),
    } as unknown as jest.Mocked<Repository<ConversationMember>>;

    userRepo = {
      findOneBy: jest.fn(async (cond) => {
        if ('id' in cond && (cond as { id: string }).id === ZAI_ID) {
          return { id: ZAI_ID, fullName: 'Zai' } as User;
        }
        if ('id' in cond) {
          return { id: (cond as { id: string }).id, fullName: 'User' } as User;
        }
        return null;
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

    expect(conversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ConversationType.AI_ASSISTANT,
        aiContext: context,
        createdById: 'user-1',
      }),
    );
    expect(memberRepo.create).toHaveBeenCalledTimes(2);
    expect(memberRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-1',
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        }),
        expect.objectContaining({
          userId: ZAI_ID,
          role: UpdateMemberRoleDtoRoleEnum.MEMBER,
        }),
      ]),
    );
    expect(result.id).toBe('conv-new');
  });

  it('rejects when user does not exist', async () => {
    userRepo.findOneBy.mockResolvedValueOnce(null); // first call (the user) returns null

    await expect(
      service.createZaiConversation('nonexistent', {
        feature: 'general',
        created_at: Date.now(),
      }),
    ).rejects.toThrow(/user not found/i);
  });

  it('rejects when Zai bot user is missing (migration not run)', async () => {
    userRepo.findOneBy
      .mockResolvedValueOnce({ id: 'user-1', fullName: 'U' } as User)
      .mockResolvedValueOnce(null); // Zai missing

    await expect(
      service.createZaiConversation('user-1', {
        feature: 'general',
        created_at: Date.now(),
      }),
    ).rejects.toThrow(/zai bot user not seeded/i);
  });
});
