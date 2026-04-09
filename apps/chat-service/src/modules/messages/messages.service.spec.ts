/**
 * @file messages.service.spec.ts (chat-service)
 *
 * Unit tests for chat-service MessagesService — covers ScyllaDB message
 * retrieval, cursor pagination, cache layer, reactions aggregation,
 * attachment URL building, and deleted message body clearing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';

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

  beforeEach(async () => {
    messageRepository = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getReactions: jest.fn(),
    };

    cacheService = {
      getRecentMessages: jest.fn().mockResolvedValue(null),
      setRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: MessageRepository, useValue: messageRepository },
        { provide: CacheService, useValue: cacheService },
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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

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

      await service.getMessages('conv-1', {
        cursor: 'abc-cursor',
        limit: 50,
      });

      expect(cacheService.getRecentMessages).not.toHaveBeenCalled();
      expect(messageRepository.getMessages).toHaveBeenCalled();
    });

    it('should NOT cache when limit > 50', async () => {
      messageRepository.getMessages.mockResolvedValue({
        items: [],
        next_cursor: null,
        has_more: false,
      });

      await service.getMessages('conv-1', { limit: 100 });

      expect(cacheService.setRecentMessages).not.toHaveBeenCalled();
    });

    it('should default limit to 50', async () => {
      messageRepository.getMessages.mockResolvedValue({
        items: [],
        next_cursor: null,
        has_more: false,
      });

      await service.getMessages('conv-1', {});

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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

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

      const result = await service.getMessages('conv-1', {
        limit: 50,
      });

      const attachment = result.items[0].attachments![0];
      expect(attachment.thumbnailUrl).toBeUndefined();
    });

    it('should use localhost format for local CDN', async () => {
      const originalCdn = process.env.CDN_BASE_URL;
      process.env.CDN_BASE_URL = 'http://localhost:4566';

      const localService = new MessagesService(
        messageRepository as unknown as MessageRepository,
        cacheService as unknown as CacheService,
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

      const result = await localService.getMessages('conv-1', {
        limit: 50,
      });

      // Localhost format includes bucket in path
      expect(result.items[0].attachments![0].url).toMatch(
        /localhost.*\/.*test\.jpg/,
      );

      process.env.CDN_BASE_URL = originalCdn;
    });
  });
});
