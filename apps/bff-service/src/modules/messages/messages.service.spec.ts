/**
 * @file messages.service.spec.ts (BFF)
 *
 * Unit tests for BFF MessagesService — verifies all proxy delegations
 * to ChatClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { ChatClientService } from '@app/clients';

describe('BFF MessagesService', () => {
  let service: MessagesService;
  let chatClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    chatClient = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageReactions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: ChatClientService, useValue: chatClient },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    // Inject manually since token name may differ
    (service as unknown).chatClient = chatClient;
  });

  describe('getMessages', () => {
    it('should delegate to chatClient.getMessages with all params', async () => {
      const expected = { items: [], nextCursor: null, hasMore: false };
      chatClient.getMessages.mockResolvedValue(expected);

      const result = await service.getMessages(
        'token-123',
        'conv-1',
        'cursor-abc',
        50,
      );

      expect(chatClient.getMessages).toHaveBeenCalledWith(
        'token-123',
        'conv-1',
        'cursor-abc',
        50,
      );
      expect(result).toEqual(expected);
    });

    it('should pass undefined for optional params', async () => {
      chatClient.getMessages.mockResolvedValue({ items: [] });

      await service.getMessages('token', 'conv-1');

      expect(chatClient.getMessages).toHaveBeenCalledWith(
        'token',
        'conv-1',
        undefined,
        undefined,
      );
    });

    it('should propagate errors from chatClient', async () => {
      chatClient.getMessages.mockRejectedValue(new Error('Upstream error'));

      await expect(service.getMessages('token', 'conv-1')).rejects.toThrow(
        'Upstream error',
      );
    });
  });

  describe('getMessage', () => {
    it('should delegate to chatClient.getMessage with all params', async () => {
      const expected = { messageId: 'msg-1', body: 'Hello' };
      chatClient.getMessage.mockResolvedValue(expected);

      const result = await service.getMessage(
        'token',
        'conv-1',
        1706162800000,
        'msg-1',
      );

      expect(chatClient.getMessage).toHaveBeenCalledWith(
        'token',
        'conv-1',
        1706162800000,
        'msg-1',
      );
      expect(result).toEqual(expected);
    });

    it('should propagate errors from chatClient', async () => {
      chatClient.getMessage.mockRejectedValue(new Error('Not found'));

      await expect(
        service.getMessage('token', 'conv-1', 123, 'msg-1'),
      ).rejects.toThrow('Not found');
    });
  });

  describe('getMessageReactions', () => {
    it('should delegate to chatClient.getMessageReactions', async () => {
      const expected = { messageId: 'msg-1', reactions: [], summary: [] };
      chatClient.getMessageReactions.mockResolvedValue(expected);

      const result = await service.getMessageReactions('token', 'msg-1');

      expect(chatClient.getMessageReactions).toHaveBeenCalledWith(
        'token',
        'msg-1',
      );
      expect(result).toEqual(expected);
    });
  });
});
