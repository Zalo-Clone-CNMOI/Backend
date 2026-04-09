/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
/**
 * @file chat.handler.spec.ts
 * @covers ChatHandler – WS Gateway chat event handler with membership checks
 * @maps TC-WS-003 (join), TC-WS-004 (send), TC-WS-005 (edit/delete),
 *       TC-WS-006 (react/unreact), TC-SEC-005 (membership IDOR),
 *       TC-KAFKA-001 (command emission)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatHandler } from './chat.handler';
import { MediaFile } from '@libs/database';
import { ConversationMembershipService } from '@libs/mvp-access';
import { KAFKA_CLIENT } from '@libs/kafka';
import { KafkaTopics, WsEvents } from '@libs/contracts';
import type {
  WsChatSendPayload,
  WsChatEditPayload,
  WsChatDeletePayload,
  WsChatReactPayload,
  WsChatUnreactPayload,
} from '@libs/contracts';

// ────── Mock Socket Factory ──────────────────────────────────────────────

function createMockSocket(userId = 'user-abc') {
  return {
    id: 'socket-id-123',
    data: { userId },
    emit: jest.fn(),
    join: jest.fn(),
  } as any;
}

// ────── Payload Factories ────────────────────────────────────────────────

function makeSendPayload(
  overrides?: Partial<WsChatSendPayload>,
): WsChatSendPayload {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    body: 'Hello, world!',
    sent_at: Date.now(),
    ...overrides,
  } as WsChatSendPayload;
}

function makeEditPayload(
  overrides?: Partial<WsChatEditPayload>,
): WsChatEditPayload {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    new_body: 'Edited content',
    ...overrides,
  } as WsChatEditPayload;
}

function makeDeletePayload(
  overrides?: Partial<WsChatDeletePayload>,
): WsChatDeletePayload {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    ...overrides,
  } as WsChatDeletePayload;
}

function makeReactPayload(
  overrides?: Partial<WsChatReactPayload>,
): WsChatReactPayload {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    reaction_type: '👍',
    ...overrides,
  } as WsChatReactPayload;
}

function makeUnreactPayload(
  overrides?: Partial<WsChatUnreactPayload>,
): WsChatUnreactPayload {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    ...overrides,
  } as WsChatUnreactPayload;
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('ChatHandler', () => {
  let handler: ChatHandler;
  let membership: jest.Mocked<ConversationMembershipService>;
  let kafka: { emit: jest.Mock };
  let mediaFileRepo: { find: jest.Mock };

  beforeEach(async () => {
    kafka = { emit: jest.fn() };
    mediaFileRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatHandler,
        { provide: KAFKA_CLIENT, useValue: kafka },
        {
          provide: ConversationMembershipService,
          useValue: {
            canUserAccessConversation: jest.fn(),
          },
        },
        { provide: getRepositoryToken(MediaFile), useValue: mediaFileRepo },
      ],
    }).compile();

    handler = module.get(ChatHandler);
    membership = module.get(ConversationMembershipService);
  });

  // ── handleJoin ────────────────────────────────────────────────────────

  describe('handleJoin', () => {
    it('should join conversation room when user is a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleJoin(socket, 'conv-001');

      expect(membership.canUserAccessConversation).toHaveBeenCalledWith(
        'user-abc',
        'conv-001',
      );
      expect(socket.join).toHaveBeenCalledWith('conv:conv-001');
    });

    it('should emit rejected ack when user is NOT a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleJoin(socket, 'conv-001');

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: '',
        status: 'rejected',
        reason: 'not_member',
      });
    });

    it('should use socket.data.userId (not hardcoded)', async () => {
      const socket = createMockSocket('different-user');
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleJoin(socket, 'conv-xyz');

      expect(membership.canUserAccessConversation).toHaveBeenCalledWith(
        'different-user',
        'conv-xyz',
      );
    });
  });

  // ── handleSend ────────────────────────────────────────────────────────

  describe('handleSend', () => {
    it('should emit Kafka command and success ack for authorized user', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({
          message_id: body.message_id,
          conversation_id: body.conversation_id,
          sender_id: 'user-abc',
          body: body.body,
          sent_at: body.sent_at,
          trace_id: expect.stringContaining(socket.id),
        }),
      );

      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'accepted',
      });
    });

    it('should reject with not_member when user has no access', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      });
    });

    it('should include reply_to_message_id when present', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload({ reply_to_message_id: 'original-msg-id' });
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({
          reply_to_message_id: 'original-msg-id',
        }),
      );
    });

    it('should include attachments in Kafka command', async () => {
      const socket = createMockSocket();
      const attachments = [
        {
          key: 'private/uploads/img-1.png',
          type: 'image' as const,
          name: 'img-1.png',
          size: 1024,
          content_type: 'image/png',
        },
      ];
      mediaFileRepo.find.mockResolvedValue([
        {
          key: 'private/uploads/img-1.png',
          uploadedById: 'user-abc',
          status: 'uploaded',
        },
      ]);

      const body = makeSendPayload({ attachments });
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({ attachments }),
      );
    });
  });

  // ── handleEdit ────────────────────────────────────────────────────────

  describe('handleEdit', () => {
    it('should emit edit command for authorized user', async () => {
      const socket = createMockSocket();
      const body = makeEditPayload();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleEdit(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageEdit,
        expect.objectContaining({
          message_id: body.message_id,
          conversation_id: body.conversation_id,
          sender_id: 'user-abc',
          new_body: body.new_body,
          edited_at: expect.any(Number),
        }),
      );

      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'accepted',
      });
    });

    it('should reject edit when user is not a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleEdit(socket, makeEditPayload());

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        WsEvents.ChatAck,
        expect.objectContaining({ status: 'rejected', reason: 'not_member' }),
      );
    });
  });

  // ── handleDelete ──────────────────────────────────────────────────────

  describe('handleDelete', () => {
    it('should emit delete command for authorized user', async () => {
      const socket = createMockSocket();
      const body = makeDeletePayload();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleDelete(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageDelete,
        expect.objectContaining({
          message_id: body.message_id,
          conversation_id: body.conversation_id,
          sender_id: 'user-abc',
          deleted_at: expect.any(Number),
        }),
      );
    });

    it('should reject delete when user is not a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleDelete(socket, makeDeletePayload());

      expect(kafka.emit).not.toHaveBeenCalled();
    });
  });

  // ── handleReact ───────────────────────────────────────────────────────

  describe('handleReact', () => {
    it('should emit reaction add command for authorized user', async () => {
      const socket = createMockSocket();
      const body = makeReactPayload({ reaction_type: 'love' });
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleReact(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatReactionAdd,
        expect.objectContaining({
          message_id: body.message_id,
          conversation_id: body.conversation_id,
          user_id: 'user-abc',
          reaction_type: 'love',
          created_at: expect.any(Number),
        }),
      );

      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'accepted',
      });
    });

    it('should reject reaction when user is not a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleReact(socket, makeReactPayload());

      expect(kafka.emit).not.toHaveBeenCalled();
    });
  });

  // ── handleUnreact ─────────────────────────────────────────────────────

  describe('handleUnreact', () => {
    it('should emit reaction remove command for authorized user', async () => {
      const socket = createMockSocket();
      const body = makeUnreactPayload();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleUnreact(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatReactionRemove,
        expect.objectContaining({
          message_id: body.message_id,
          conversation_id: body.conversation_id,
          user_id: 'user-abc',
        }),
      );

      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'accepted',
      });
    });

    it('should reject unreact when user is not a member', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleUnreact(socket, makeUnreactPayload());

      expect(kafka.emit).not.toHaveBeenCalled();
    });
  });

  // ── Cross-cutting: Membership Security ─────────────────────────────

  describe('membership security (IDOR prevention)', () => {
    it('should use socket.data.userId, never trust client-provided userId', async () => {
      const socket = createMockSocket('real-user-id');
      // Even if conversation_id is someone else's, check uses real user
      const body = makeSendPayload({ conversation_id: 'private-conv' });
      membership.canUserAccessConversation.mockResolvedValue(false);

      await handler.handleSend(socket, body);

      expect(membership.canUserAccessConversation).toHaveBeenCalledWith(
        'real-user-id',
        'private-conv',
      );
    });

    it('should set sender_id from socket, not from payload', async () => {
      const socket = createMockSocket('server-verified-user');
      const body = makeSendPayload();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({ sender_id: 'server-verified-user' }),
      );
    });

    it('should check membership for EVERY operation type', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(true);

      await handler.handleJoin(socket, 'conv-001');
      await handler.handleSend(socket, makeSendPayload());
      await handler.handleEdit(socket, makeEditPayload());
      await handler.handleDelete(socket, makeDeletePayload());
      await handler.handleReact(socket, makeReactPayload());
      await handler.handleUnreact(socket, makeUnreactPayload());

      // 6 operations = 6 membership checks (join uses conversationId directly)
      expect(membership.canUserAccessConversation).toHaveBeenCalledTimes(6);
    });
  });
});
