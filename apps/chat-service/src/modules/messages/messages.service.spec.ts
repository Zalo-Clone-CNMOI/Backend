/**
 * @file messages.service.spec.ts (chat-service)
 *
 * Unit tests for chat-service MessagesService — covers ScyllaDB message
 * retrieval, cursor pagination, cache layer, reactions aggregation,
 * attachment URL building, and deleted message body clearing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { BusinessException } from '@app/types';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { MediaClientService } from '@app/clients';
import {
  ConversationMembershipService,
  FriendshipAccessService,
} from '@libs/mvp-access';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation, ConversationMember, User } from '@libs/database';
import { ConversationType, UpdateMemberRoleDtoRoleEnum } from '@app/constant';
import { KafkaTopics } from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { of } from 'rxjs';

// Helpers
const createMockMessage = (overrides: Record<string, unknown> = {}) => ({
  message_id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'user-1',
  body: 'Hello world',
  created_at: 1706162800000,
  attachments: null,
  reply_to_message_id: null,
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

describe('Chat MessagesService', () => {
  let service: MessagesService;
  let messageRepository: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;
  let mediaClient: Record<string, jest.Mock>;
  let membershipService: Record<string, jest.Mock>;
  let friendshipAccessService: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let conversationRepo: Record<string, jest.Mock>;
  let conversationMemberRepo: Record<string, jest.Mock>;
  let kafka: Record<string, jest.Mock>;

  beforeEach(async () => {
    messageRepository = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageById: jest.fn(),
      getPinnedMessage: jest.fn(),
      getPinnedMessages: jest.fn(),
      pinMessage: jest.fn(),
      unpinMessage: jest.fn(),
      getReactions: jest.fn(),
    };

    cacheService = {
      getRecentMessages: jest.fn().mockResolvedValue(null),
      setRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    mediaClient = { cloneAttachment: jest.fn() };
    membershipService = { canUserAccessConversation: jest.fn() };
    friendshipAccessService = { canMessageUser: jest.fn() };
    userRepo = { findOne: jest.fn() };
    conversationRepo = { findOne: jest.fn() };
    conversationMemberRepo = { findOne: jest.fn() };
    kafka = {
      emit: jest.fn().mockReturnValue(of(undefined)),
      connect: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: MessageRepository, useValue: messageRepository },
        { provide: CacheService, useValue: cacheService },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: ConversationMembershipService, useValue: membershipService },
        { provide: FriendshipAccessService, useValue: friendshipAccessService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepo,
        },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: conversationMemberRepo,
        },
        { provide: KAFKA_CLIENT, useValue: kafka },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  // ─── getMessages ─────────────────────────────────────

  describe('getMessages', () => {
    it('should return cached result on first page cache hit', async () => {
      const cached = {
        items: [{ messageId: 'msg-1' }],
        nextCursor: null,
        hasMore: false,
      };
      cacheService.getRecentMessages.mockResolvedValue(cached);

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      expect(cacheService.getRecentMessages).toHaveBeenCalledWith('conv-1');
      expect(messageRepository.getMessages).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query ScyllaDB on cache miss for first page', async () => {
      cacheService.getRecentMessages.mockResolvedValue(null);
      messageRepository.getMessages.mockResolvedValue({
        items: [createMockMessage()],
        next_cursor: null,
        has_more: false,
      });

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      expect(messageRepository.getMessages).toHaveBeenCalledWith('conv-1', {
        cursor: undefined,
        limit: 50,
      });
      expect(cacheService.setRecentMessages).toHaveBeenCalledWith(
        'conv-1',
        expect.any(Object),
      );
      expect(result.items).toHaveLength(1);
    });

    it('should NOT use cache for paginated requests (with cursor)', async () => {
      messageRepository.getMessages.mockResolvedValue({
        items: [],
        next_cursor: null,
        has_more: false,
      });

      await service.getMessages(
        'conv-1',
        {
          cursor: 'abc-cursor',
          limit: 50,
        },
        'user-1',
      );

      expect(cacheService.getRecentMessages).not.toHaveBeenCalled();
      expect(messageRepository.getMessages).toHaveBeenCalled();
    });

    it('should NOT cache when limit > 50', async () => {
      messageRepository.getMessages.mockResolvedValue({
        items: [],
        next_cursor: null,
        has_more: false,
      });

      await service.getMessages('conv-1', { limit: 100 }, 'user-1');

      expect(cacheService.setRecentMessages).not.toHaveBeenCalled();
    });

    it('should default limit to 50', async () => {
      messageRepository.getMessages.mockResolvedValue({
        items: [],
        next_cursor: null,
        has_more: false,
      });

      await service.getMessages('conv-1', {}, 'user-1');

      expect(messageRepository.getMessages).toHaveBeenCalledWith('conv-1', {
        cursor: undefined,
        limit: 50,
      });
    });

    it('should map PersistedMessage to MessageResponseDto', async () => {
      const msg = createMockMessage({
        reply_to_message_id: 'reply-msg',
        edited_at: 1706163000000,
      });
      messageRepository.getMessages.mockResolvedValue({
        items: [msg],
        next_cursor: 'next',
        has_more: true,
      });

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          messageId: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'user-1',
          body: 'Hello world',
          replyToMessageId: 'reply-msg',
          editedAt: 1706163000000,
          isDeleted: false,
        }),
      );
      expect(result.nextCursor).toBe('next');
      expect(result.hasMore).toBe(true);
    });

    it('should clear body for deleted messages', async () => {
      const msg = createMockMessage({ deleted_at: 1706164000000 });
      messageRepository.getMessages.mockResolvedValue({
        items: [msg],
        next_cursor: null,
        has_more: false,
      });

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      expect(result.items[0].body).toBe('');
      expect(result.items[0].isDeleted).toBe(true);
      expect(result.items[0].deletedAt).toBe(1706164000000);
    });
  });

  // ─── getMessage ──────────────────────────────────────

  describe('getMessage', () => {
    it('should return mapped message when found', async () => {
      messageRepository.getMessage.mockResolvedValue(createMockMessage());

      const result = await service.getMessage('conv-1', 1706162800000, 'msg-1');

      expect(messageRepository.getMessage).toHaveBeenCalledWith(
        'conv-1',
        1706162800000,
        'msg-1',
      );
      expect(result).toBeDefined();
      expect(result!.messageId).toBe('msg-1');
    });

    it('should return null when message not found', async () => {
      messageRepository.getMessage.mockResolvedValue(null);

      const result = await service.getMessage('conv-1', 123, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── getMessageReactions ─────────────────────────────

  describe('getMessageReactions', () => {
    it('should return reactions with summary aggregation', async () => {
      const reactions = [
        { user_id: 'user-1', reaction_type: 'love', created_at: 1000 },
        { user_id: 'user-2', reaction_type: 'love', created_at: 1001 },
        { user_id: 'user-3', reaction_type: 'haha', created_at: 1002 },
      ];
      messageRepository.getReactions.mockResolvedValue(reactions);

      const result = await service.getMessageReactions('msg-1');

      expect(result.messageId).toBe('msg-1');
      expect(result.reactions).toHaveLength(3);

      // Summary should aggregate by type
      const loveSummary = result.summary.find((s) => s.type === 'love');
      expect(loveSummary).toBeDefined();
      expect(loveSummary!.count).toBe(2);
      expect(loveSummary!.userIds).toEqual(['user-1', 'user-2']);

      const hahaSummary = result.summary.find((s) => s.type === 'haha');
      expect(hahaSummary).toBeDefined();
      expect(hahaSummary!.count).toBe(1);
    });

    it('should return empty reactions when none exist', async () => {
      messageRepository.getReactions.mockResolvedValue([]);

      const result = await service.getMessageReactions('msg-1');

      expect(result.reactions).toHaveLength(0);
      expect(result.summary).toHaveLength(0);
    });
  });

  // ─── pinMessage / unpinMessage permissions ───────────

  describe('pin permissions', () => {
    const groupConversation = {
      id: 'conv-1',
      type: ConversationType.GROUP,
    } as Conversation;

    const groupMemberRole = {
      conversationId: 'conv-1',
      userId: 'member-1',
      role: UpdateMemberRoleDtoRoleEnum.MEMBER,
      leftAt: null,
    } as ConversationMember;

    const groupAdminRole = {
      ...groupMemberRole,
      role: UpdateMemberRoleDtoRoleEnum.ADMIN,
    } as ConversationMember;

    it('should reject pin when user is MEMBER in group', async () => {
      conversationRepo.findOne.mockResolvedValue(groupConversation);
      conversationMemberRepo.findOne.mockResolvedValue(groupMemberRole);

      await expect(
        service.pinMessage('conv-1', 1706162800000, 'msg-1', 'member-1'),
      ).rejects.toThrow(BusinessException);

      expect(messageRepository.pinMessage).not.toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalledWith(
        KafkaTopics.ChatMessagePinned,
        expect.anything(),
      );
    });

    it('should allow pin when user is ADMIN in group', async () => {
      conversationRepo.findOne.mockResolvedValue(groupConversation);
      conversationMemberRepo.findOne.mockResolvedValue(groupAdminRole);
      messageRepository.getMessage.mockResolvedValue(
        createMockMessage({
          message_id: 'msg-1',
          conversation_id: 'conv-1',
          created_at: 1706162800000,
        }),
      );
      messageRepository.getPinnedMessage.mockResolvedValue(null);

      const result = await service.pinMessage(
        'conv-1',
        1706162800000,
        'msg-1',
        'admin-1',
      );

      expect(messageRepository.pinMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv-1',
          message_id: 'msg-1',
          created_at: 1706162800000,
          pinned_by: 'admin-1',
        }),
      );
      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessagePinned,
        expect.objectContaining({
          message_id: 'msg-1',
          conversation_id: 'conv-1',
          created_at: 1706162800000,
          pinned_by: 'admin-1',
        }),
      );
      expect(result).toEqual({ message: 'Message pinned' });
    });

    it('should reject unpin when MEMBER tries to unpin another user pin', async () => {
      conversationRepo.findOne.mockResolvedValue(groupConversation);
      conversationMemberRepo.findOne.mockResolvedValue(groupMemberRole);
      messageRepository.getPinnedMessage.mockResolvedValue({
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        created_at: 1706162800000,
        pinned_by: 'owner-1',
        pinned_at: 1706162900000,
      });

      await expect(
        service.unpinMessage('conv-1', 1706162800000, 'msg-1', 'member-1'),
      ).rejects.toThrow(BusinessException);

      expect(messageRepository.unpinMessage).not.toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalledWith(
        KafkaTopics.ChatMessageUnpinned,
        expect.anything(),
      );
    });

    it('should allow unpin when MEMBER unpins own pin', async () => {
      conversationRepo.findOne.mockResolvedValue(groupConversation);
      conversationMemberRepo.findOne.mockResolvedValue(groupMemberRole);
      messageRepository.getPinnedMessage.mockResolvedValue({
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        created_at: 1706162800000,
        pinned_by: 'member-1',
        pinned_at: 1706162900000,
      });

      const result = await service.unpinMessage(
        'conv-1',
        1706162800000,
        'msg-1',
        'member-1',
      );

      expect(messageRepository.unpinMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv-1',
          message_id: 'msg-1',
          pinned_by: 'member-1',
        }),
      );
      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageUnpinned,
        expect.objectContaining({
          message_id: 'msg-1',
          conversation_id: 'conv-1',
          created_at: 1706162800000,
          unpinned_by: 'member-1',
        }),
      );
      expect(result).toEqual({ message: 'Message unpinned' });
    });
  });

  // ─── Attachments & CDN ───────────────────────────────

  describe('attachment URL building', () => {
    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
    });

    afterEach(() => {
      delete process.env.S3_BUCKET;
    });

    it('should build CDN URL for attachment', async () => {
      const msg = createMockMessage({
        attachments: [
          {
            key: 'images/photo.jpg',
            type: 'image',
            name: 'photo.jpg',
            size: 1024,
            content_type: 'image/jpeg',
            thumbnail_key: 'thumbs/photo_thumb.jpg',
          },
        ],
      });
      messageRepository.getMessages.mockResolvedValue({
        items: [msg],
        next_cursor: null,
        has_more: false,
      });

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      const attachment = result.items[0].attachments![0];
      expect(attachment.key).toBe('images/photo.jpg');
      expect(attachment.url).toContain('images/photo.jpg');
      expect(attachment.thumbnailUrl).toContain('thumbs/photo_thumb.jpg');
    });

    it('should not include thumbnailUrl when no thumbnail key', async () => {
      const msg = createMockMessage({
        attachments: [
          {
            key: 'files/doc.pdf',
            type: 'file',
            name: 'doc.pdf',
            size: 2048,
            content_type: 'application/pdf',
            thumbnail_key: null,
          },
        ],
      });
      messageRepository.getMessages.mockResolvedValue({
        items: [msg],
        next_cursor: null,
        has_more: false,
      });

      const result = await service.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      const attachment = result.items[0].attachments![0];
      expect(attachment.thumbnailUrl).toBeUndefined();
    });

    it('should use localhost format for local CDN', async () => {
      const originalEndpoint = process.env.S3_ENDPOINT;
      const originalBucket = process.env.S3_BUCKET;
      process.env.S3_ENDPOINT = 'http://localhost:4566';
      process.env.S3_BUCKET = 'be-media';

      const localService = new MessagesService(
        messageRepository as unknown as MessageRepository,
        cacheService as unknown as CacheService,
        mediaClient as unknown as MediaClientService,
        membershipService as unknown as ConversationMembershipService,
        {} as FriendshipAccessService, // mock FriendshipAccessService
        userRepo as unknown as never,
        conversationRepo as unknown as never,
        conversationMemberRepo as unknown as never,
        kafka as unknown as never,
      );

      const msg = createMockMessage({
        attachments: [
          {
            key: 'test.jpg',
            type: 'image',
            name: 'test.jpg',
            size: 100,
            content_type: 'image/jpeg',
            thumbnail_key: null,
          },
        ],
      });
      messageRepository.getMessages.mockResolvedValue({
        items: [msg],
        next_cursor: null,
        has_more: false,
      });

      const result = await localService.getMessages(
        'conv-1',
        {
          limit: 50,
        },
        'user-1',
      );

      // Localhost format includes bucket in path
      expect(result.items[0].attachments![0].url).toMatch(
        /localhost.*\/be-media\/test\.jpg/,
      );

      process.env.S3_ENDPOINT = originalEndpoint;
      process.env.S3_BUCKET = originalBucket;
    });
  });
});
