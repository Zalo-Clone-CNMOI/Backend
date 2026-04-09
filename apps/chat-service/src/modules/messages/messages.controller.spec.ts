/**
 * @file messages.controller.spec.ts (chat-service)
 *
 * Unit tests for chat-service MessagesController — covers route delegation,
 * NotFoundException for missing messages, and UUID parsing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

describe('Chat MessagesController', () => {
  let controller: MessagesController;
  let messagesService: Record<string, jest.Mock>;

  beforeEach(async () => {
    messagesService = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
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
      const result = await controller.getMessages(
        'conv-uuid',
        query as unknown,
      );

      expect(messagesService.getMessages).toHaveBeenCalledWith(
        'conv-uuid',
        query,
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
        '1706162800000',
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
        controller.getMessage('conv-1', '123', 'nonexistent-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should parse createdAt as integer', async () => {
      messagesService.getMessage.mockResolvedValue({ messageId: 'msg-1' });

      await controller.getMessage('conv-1', '1706162800000', 'msg-1');

      expect(messagesService.getMessage).toHaveBeenCalledWith(
        'conv-1',
        1706162800000,
        'msg-1',
      );
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
