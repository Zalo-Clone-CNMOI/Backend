/**
 * @file messages.controller.spec.ts (BFF)
 *
 * Unit tests for BFF MessagesController — verifies token extraction via
 * @AccessToken() and correct delegation to MessagesService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { JwtService } from '@libs/auth';

describe('BFF MessagesController', () => {
  let controller: MessagesController;
  let messagesService: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;

  beforeEach(async () => {
    messagesService = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageReactions: jest.fn(),
      forwardMessage: jest.fn(),
    };

    jwtService = {
      verifyToken: jest.fn().mockReturnValue({ userId: 'user-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    controller = module.get<MessagesController>(MessagesController);
  });

  describe('GET /messages/:conversationId', () => {
    it('should pass token, conversationId, cursor, and limit to service', async () => {
      const expected = { items: [], nextCursor: null, hasMore: false };
      messagesService.getMessages.mockResolvedValue(expected);

      const result = await controller.getMessages(
        'access-token',
        'conv-uuid-1',
        'cursor-abc',
        25,
      );

      expect(messagesService.getMessages).toHaveBeenCalledWith(
        'access-token',
        'conv-uuid-1',
        'user-1',
        'cursor-abc',
        25,
      );
      expect(result).toEqual(expected);
    });

    it('should pass undefined for optional params', async () => {
      messagesService.getMessages.mockResolvedValue({ items: [] });

      await controller.getMessages('token', 'conv-1');

      expect(messagesService.getMessages).toHaveBeenCalledWith(
        'token',
        'conv-1',
        'user-1',
        undefined,
        undefined,
      );
    });
  });

  describe('GET /messages/:conversationId/:createdAt/:messageId', () => {
    it('should pass all params to service', async () => {
      const expected = { messageId: 'msg-1', body: 'Hello' };
      messagesService.getMessage.mockResolvedValue(expected);

      const result = await controller.getMessage(
        'token',
        'conv-1',
        1706162800000,
        'msg-uuid-1',
      );

      expect(messagesService.getMessage).toHaveBeenCalledWith(
        'token',
        'conv-1',
        1706162800000,
        'msg-uuid-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('GET /messages/:messageId/reactions', () => {
    it('should pass token and messageId to service', async () => {
      const expected = { messageId: 'msg-1', reactions: [], summary: [] };
      messagesService.getMessageReactions.mockResolvedValue(expected);

      const result = await controller.getMessageReactions('token', 'msg-1');

      expect(messagesService.getMessageReactions).toHaveBeenCalledWith(
        'token',
        'msg-1',
      );
      expect(result).toEqual(expected);
    });
  });
});
