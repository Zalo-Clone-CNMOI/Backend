/**
 * @file messages.service.spec.ts (BFF)
 *
 * Unit tests for BFF MessagesService — verifies all proxy delegations
 * to ChatClientService.
 */
import 'reflect-metadata';
import { of } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { ChatClientService } from '@app/clients';
import { MediaClientService } from '@app/clients';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { KafkaTopics } from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { ConversationMembershipService } from '@libs/mvp-access';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '@libs/database';
import { ForwardMessageDto } from './dto/forward-message.dto';

describe('BFF MessagesService', () => {
  let service: MessagesService;
  let chatClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    chatClient = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageById: jest.fn(),
      getMessageReactions: jest.fn(),
      searchMessages: jest.fn(),
    };

    const mediaClient = { cloneAttachment: jest.fn() };
    const membershipService = { canUserAccessConversation: jest.fn() };
    const userRepo = { findOne: jest.fn() };
    const kafka = {
      emit: jest.fn().mockReturnValue(of(undefined)),
      connect: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: ChatClientService, useValue: chatClient },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: ConversationMembershipService, useValue: membershipService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: KAFKA_CLIENT, useValue: kafka },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
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

describe('MessagesService.forwardMessage', () => {
  let fwdChatClient: {
    getMessageById: jest.Mock;
    getMessages: jest.Mock;
    getMessage: jest.Mock;
    getMessageReactions: jest.Mock;
    searchMessages: jest.Mock;
  };
  let mediaClient: { cloneAttachment: jest.Mock };
  let membershipService: { canUserAccessConversation: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let kafka: { emit: jest.Mock; connect: jest.Mock };
  let fwdService: MessagesService;

  const ACCESS_TOKEN = 'bearer-test-token';
  const USER_ID = 'user-forwarder';

  const makeDto = (
    overrides: Partial<ForwardMessageDto> = {},
  ): ForwardMessageDto =>
    ({
      forward_id: 'fwd-001',
      source_message_id: 'src-msg-001',
      targets: [
        { message_id: 'new-msg-001', conversation_id: 'target-conv-001' },
      ],
      ...overrides,
    }) as ForwardMessageDto;

  const sourceMessage = {
    messageId: 'src-msg-001',
    conversationId: 'src-conv-001',
    senderId: 'original-sender',
    body: 'Hello world',
    createdAt: Date.now() - 60_000,
    attachments: [],
    isDeleted: false,
  };

  beforeEach(async () => {
    fwdChatClient = {
      getMessages: jest.fn(),
      getMessage: jest.fn(),
      getMessageById: jest.fn(),
      searchMessages: jest.fn(),
      getMessageReactions: jest.fn(),
    };
    mediaClient = { cloneAttachment: jest.fn() };
    membershipService = { canUserAccessConversation: jest.fn() };
    userRepo = { findOne: jest.fn() };
    kafka = {
      emit: jest.fn().mockReturnValue(of(undefined)),
      connect: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: ChatClientService, useValue: fwdChatClient },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: ConversationMembershipService, useValue: membershipService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: KAFKA_CLIENT, useValue: kafka },
      ],
    }).compile();

    fwdService = module.get<MessagesService>(MessagesService);
  });

  it('should throw NotFoundException when source message not found', async () => {
    fwdChatClient.getMessageById.mockResolvedValue(null);

    await expect(
      fwdService.forwardMessage(makeDto(), ACCESS_TOKEN, USER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when user cannot read source conversation', async () => {
    fwdChatClient.getMessageById.mockResolvedValue(sourceMessage);
    membershipService.canUserAccessConversation.mockResolvedValue(false);

    await expect(
      fwdService.forwardMessage(makeDto(), ACCESS_TOKEN, USER_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should emit Kafka command and return accepted for valid target', async () => {
    fwdChatClient.getMessageById.mockResolvedValue(sourceMessage);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    userRepo.findOne.mockResolvedValue({ fullName: 'Original Sender' });

    const result = await fwdService.forwardMessage(
      makeDto(),
      ACCESS_TOKEN,
      USER_ID,
    );

    expect(kafka.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatMessageForward,
      expect.objectContaining({
        message_id: 'new-msg-001',
        conversation_id: 'target-conv-001',
        sender_id: USER_ID,
        body: 'Hello world',
        forwarded_from: expect.objectContaining({
          source_message_id: 'src-msg-001',
          source_sender_name_snapshot: 'Original Sender',
          source_type: 'text',
        }),
        forward_id: 'fwd-001',
      }),
    );
    expect(result.results[0]).toMatchObject({
      message_id: 'new-msg-001',
      conversation_id: 'target-conv-001',
      status: 'accepted',
    });
  });

  it('should reject individual target when user is not member', async () => {
    const dto = makeDto({
      targets: [
        { message_id: 'msg-ok', conversation_id: 'conv-ok' },
        { message_id: 'msg-bad', conversation_id: 'conv-bad' },
      ],
    });

    fwdChatClient.getMessageById.mockResolvedValue(sourceMessage);
    userRepo.findOne.mockResolvedValue({ fullName: 'Original Sender' });

    membershipService.canUserAccessConversation
      .mockResolvedValueOnce(true) // source access
      .mockResolvedValueOnce(true) // conv-ok
      .mockResolvedValueOnce(false); // conv-bad

    const result = await fwdService.forwardMessage(dto, ACCESS_TOKEN, USER_ID);

    expect(kafka.emit).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      message_id: 'msg-ok',
      status: 'accepted',
    });
    expect(result.results[1]).toMatchObject({
      message_id: 'msg-bad',
      status: 'rejected',
      reason: 'not_member',
    });
  });

  it('should clone attachments and use cloned keys in Kafka command', async () => {
    const sourceWithAttachments = {
      ...sourceMessage,
      body: '',
      attachments: [
        {
          key: 'private/orig.jpg',
          type: 'image',
          name: 'photo.jpg',
          size: 50000,
          contentType: 'image/jpeg',
          thumbnailKey: null,
          visibility: 'private',
          url: null,
        },
      ],
    };
    fwdChatClient.getMessageById.mockResolvedValue(sourceWithAttachments);
    membershipService.canUserAccessConversation.mockResolvedValue(true);
    userRepo.findOne.mockResolvedValue({ fullName: 'Original Sender' });
    mediaClient.cloneAttachment.mockResolvedValue({
      cloned_key: 'private/fwd-clone.jpg',
      visibility: 'private',
      content_type: 'image/jpeg',
      size_bytes: 50000,
    });

    await fwdService.forwardMessage(makeDto(), ACCESS_TOKEN, USER_ID);

    expect(mediaClient.cloneAttachment).toHaveBeenCalledWith(
      { source_key: 'private/orig.jpg', conversation_id: 'target-conv-001' },
      USER_ID,
    );
    expect(kafka.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatMessageForward,
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ key: 'private/fwd-clone.jpg' }),
        ],
      }),
    );
  });
});
