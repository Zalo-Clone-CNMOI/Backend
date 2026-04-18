/**
 * @file messages.service.spec.ts (BFF)
 *
 * Unit tests for BFF MessagesService — verifies proxy delegation to ChatClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { ChatClientService } from '@app/clients';
import type { ForwardMessageDto } from './dto/forward-message.dto';

describe('BFF MessagesService', () => {
  let service: MessagesService;
  let chatClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    chatClient = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageReactions: jest.fn(),
      searchMessages: jest.fn(),
      forwardMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: ChatClientService, useValue: chatClient },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  it('should delegate getMessages to chatClient', async () => {
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

  it('should delegate getMessage to chatClient', async () => {
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

  it('should delegate getMessageReactions to chatClient', async () => {
    const expected = { messageId: 'msg-1', reactions: [], summary: [] };
    chatClient.getMessageReactions.mockResolvedValue(expected);

    const result = await service.getMessageReactions('token', 'msg-1');

    expect(chatClient.getMessageReactions).toHaveBeenCalledWith(
      'token',
      'msg-1',
    );
    expect(result).toEqual(expected);
  });

  it('should delegate searchMessages to chatClient', async () => {
    const expected = { items: [], total: 0 };
    chatClient.searchMessages.mockResolvedValue(expected);

    const result = await service.searchMessages(
      'token',
      'conv-1',
      'hello',
      'sender-1',
      1000,
      2000,
    );

    expect(chatClient.searchMessages).toHaveBeenCalledWith(
      'token',
      'conv-1',
      'hello',
      'sender-1',
      1000,
      2000,
      undefined,
    );
    expect(result).toEqual(expected);
  });

  it('should delegate forwardMessage to chatClient', async () => {
    const dto: ForwardMessageDto = {
      forward_id: '11111111-1111-1111-1111-111111111111',
      source_message_id: '22222222-2222-2222-2222-222222222222',
      targets: [
        {
          message_id: '33333333-3333-3333-3333-333333333333',
          conversation_id: '44444444-4444-4444-4444-444444444444',
        },
      ],
    };
    const expected = {
      forward_id: dto.forward_id,
      results: [
        {
          message_id: dto.targets[0].message_id,
          conversation_id: dto.targets[0].conversation_id,
          status: 'accepted' as const,
        },
      ],
    };
    chatClient.forwardMessage.mockResolvedValue(expected);

    const result = await service.forwardMessage(dto, 'token', 'user-id');

    expect(chatClient.forwardMessage).toHaveBeenCalledWith(
      'token',
      dto,
      'user-id',
    );
    expect(result).toEqual(expected);
  });
});
