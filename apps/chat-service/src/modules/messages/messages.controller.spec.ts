/**
 * @file messages.controller.spec.ts (chat-service)
 *
 * Unit tests for chat-service MessagesController — covers route delegation,
 * NotFoundException for missing messages, and UUID parsing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '@app/types';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

describe('Chat MessagesController', () => {
  let controller: MessagesController;
  let messagesService: Record<string, jest.Mock>;

  beforeEach(async () => {
    messagesService = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getPinnedMessages: jest.fn(),
      pinMessage: jest.fn(),
      unpinMessage: jest.fn(),
      getMessageReactions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [{ provide: MessagesService, useValue: messagesService }],
    }).compile();

    controller = module.get<MessagesController>(MessagesController);
  });

  describe('GET /v1/messages/:conversationId', () => {
    it('should pass conversationId and query to service', async () => {
      const expected = { items: [], nextCursor: null, hasMore: false };
      messagesService.getMessages.mockResolvedValue(expected);

      const query = { limit: 50, cursor: 'abc' };
      const result = await controller.getMessages('conv-uuid', query, 'user-uuid');

      expect(messagesService.getMessages).toHaveBeenCalledWith(
        'conv-uuid',
        query,
        'user-uuid',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('GET /v1/messages/:conversationId/:createdAt/:messageId', () => {
    it('should return message when found', async () => {
      const expected = { messageId: 'msg-1', body: 'Hello' };
      messagesService.getMessage.mockResolvedValue(expected);

      const result = await controller.getMessage(
        'conv-1',
        1706162800000,
        'msg-uuid',
      );

      expect(messagesService.getMessage).toHaveBeenCalledWith(
        'conv-1',
        1706162800000,
        'msg-uuid',
      );
      expect(result).toEqual(expected);
    });

    it('should throw NotFoundException when message not found', async () => {
      messagesService.getMessage.mockResolvedValue(null);

      await expect(
        controller.getMessage('conv-1', 123, 'nonexistent-uuid'),
      ).rejects.toThrow(BusinessException);
    });

    it('should parse createdAt as integer', async () => {
      messagesService.getMessage.mockResolvedValue({ messageId: 'msg-1' });

      await controller.getMessage('conv-1', 1706162800000, 'msg-1');

      expect(messagesService.getMessage).toHaveBeenCalledWith(
        'conv-1',
        1706162800000,
        'msg-1',
      );
    });
  });

  describe('pin message endpoints', () => {
    it('should require x-user-id for GET pinned messages', async () => {
      await expect(
        controller.getPinnedMessages('conv-1', undefined, '20'),
      ).rejects.toThrow(BusinessException);
    });

    it('should delegate getPinnedMessages with parsed limit', async () => {
      const expected = { items: [], total: 0 };
      messagesService.getPinnedMessages.mockResolvedValue(expected);

      const result = await controller.getPinnedMessages(
        'conv-1',
        'user-1',
        '30',
      );

      expect(messagesService.getPinnedMessages).toHaveBeenCalledWith(
        'conv-1',
        'user-1',
        30,
      );
      expect(result).toEqual(expected);
    });

    it('should delegate pinMessage with numeric createdAt', async () => {
      messagesService.pinMessage.mockResolvedValue({
        message: 'Message pinned',
      });

      const result = await controller.pinMessage(
        'conv-1',
        1706162800000,
        'msg-1',
        'user-1',
      );

      expect(messagesService.pinMessage).toHaveBeenCalledWith(
        'conv-1',
        1706162800000,
        'msg-1',
        'user-1',
      );
      expect(result).toEqual({ message: 'Message pinned' });
    });

    it('should require x-user-id for unpinMessage', async () => {
      await expect(
        controller.unpinMessage('conv-1', 1706162800000, 'msg-1', undefined),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('GET /v1/messages/:messageId/reactions', () => {
    it('should delegate to getMessageReactions', async () => {
      const expected = { messageId: 'msg-1', reactions: [], summary: [] };
      messagesService.getMessageReactions.mockResolvedValue(expected);

      const result = await controller.getReactions('msg-uuid');

      expect(messagesService.getMessageReactions).toHaveBeenCalledWith(
        'msg-uuid',
      );
      expect(result).toEqual(expected);
    });
  });
});
