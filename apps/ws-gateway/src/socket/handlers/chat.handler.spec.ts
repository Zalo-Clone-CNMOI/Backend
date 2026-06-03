/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * @file chat.handler.spec.ts
 * @covers ChatHandler – WS Gateway chat event handler with membership checks
 * @maps TC-WS-003 (join), TC-WS-004 (send), TC-WS-005 (edit/delete),
 *       TC-WS-006 (react/unreact), TC-SEC-005 (membership IDOR),
 *       TC-KAFKA-001 (command emission)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ChatHandler } from './chat.handler';
import { ConversationMembershipService } from '@libs/mvp-access';
import { KAFKA_CLIENT } from '@libs/kafka';
import { RedisService } from '@libs/redis';
import { APP_CONFIG } from '@libs/config';
import { MediaClientService } from '@app/clients/media-client';
import { ConversationType } from '@app/constant';
import { KafkaTopics, WsEvents } from '@libs/contracts';
import type {
  WsChatSendPayload,
  WsChatEditPayload,
  WsChatDeletePayload,
  WsChatReactPayload,
  WsChatUnreactPayload,
  WsMention,
  MessageMention,
} from '@libs/contracts';

type AuthedSocket = Parameters<ChatHandler['handleJoin']>[0];

// ────── Mock Socket Factory ──────────────────────────────────────────────

function createMockSocket(userId = 'user-abc'): AuthedSocket {
  return {
    id: 'socket-id-123',
    data: { userId },
    emit: jest.fn(),
    join: jest.fn(),
  } as unknown as AuthedSocket;
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
  let mediaClient: { validateAttachments: jest.Mock };
  let redisService: { incrBy: jest.Mock; expire: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    kafka = { emit: jest.fn() };
    mediaClient = { validateAttachments: jest.fn().mockResolvedValue(null) };
    redisService = {
      incrBy: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatHandler,
        { provide: KAFKA_CLIENT, useValue: kafka },
        {
          provide: ConversationMembershipService,
          useValue: {
            canUserAccessConversation: jest.fn(),
            canUserSendMessage: jest.fn(),
            listActiveMemberIds: jest.fn().mockResolvedValue([]),
            getCachedConversationType: jest.fn().mockResolvedValue(ConversationType.GROUP),
          },
        },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: RedisService, useValue: redisService },
        {
          provide: APP_CONFIG,
          useValue: { zaiBotUserId: 'zai-bot-user-id' },
        },
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
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

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
      membership.canUserSendMessage.mockResolvedValue({
        allowed: false,
        reason: 'not_member',
      });

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      });
    });

    it('should reject with rate_limited when the per-user send rate is exceeded', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload();
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });
      // Over the default window cap (10).
      redisService.incrBy.mockResolvedValue(11);

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(membership.canUserSendMessage).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'rate_limited',
      });
    });

    it('should reject with moderation_cooldown while the user is cooling down', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload();
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });
      redisService.get.mockResolvedValue('1'); // cooldown key present

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      // Cooldown is checked first — the rate counter is not even touched.
      expect(redisService.incrBy).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'moderation_cooldown',
      });
    });

    it('should reject with send_permission_denied when group blocks member sends', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload();
      membership.canUserSendMessage.mockResolvedValue({
        allowed: false,
        reason: 'send_permission_denied',
      });

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'send_permission_denied',
      });
    });

    it('should include reply_to_message_id when present', async () => {
      const socket = createMockSocket();
      const body = makeSendPayload({ reply_to_message_id: 'original-msg-id' });
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({
          reply_to_message_id: 'original-msg-id',
        }),
      );
    });

    it('should include attachments in Kafka command when valid', async () => {
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
      mediaClient.validateAttachments.mockResolvedValue(null);

      const body = makeSendPayload({ attachments });
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({ attachments }),
      );
    });

    it('should reject when media-service reports attachment_not_owned', async () => {
      const socket = createMockSocket();
      const attachments = [
        {
          key: 'private/uploads/img-null-owner.png',
          type: 'image' as const,
          name: 'img-null-owner.png',
          size: 1024,
          content_type: 'image/png',
        },
      ];
      mediaClient.validateAttachments.mockResolvedValue('attachment_not_owned');

      const body = makeSendPayload({ attachments });
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'attachment_not_owned',
      });
    });

    it('should reject when media-service reports attachment_not_found', async () => {
      const socket = createMockSocket();
      const attachments = [
        {
          key: 'private/uploads/missing.png',
          type: 'image' as const,
          name: 'missing.png',
          size: 1024,
          content_type: 'image/png',
        },
      ];
      mediaClient.validateAttachments.mockResolvedValue('attachment_not_found');

      const body = makeSendPayload({ attachments });
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleSend(socket, body);

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'attachment_not_found',
      });
    });

    it('should propagate normalized mentions in Kafka emit', async () => {
      const socket = createMockSocket('user-sender');
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });
      membership.listActiveMemberIds.mockResolvedValue(['user-1']);

      await handler.handleSend(
        socket,
        makeSendPayload({
          body: 'Hi @user-1',
          mentions: [
            { user_id: 'user-1', mention_type: 'user', offset: 3, length: 6 },
          ],
        }),
      );

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({
          mentions: [
            { user_id: 'user-1', mention_type: 'user', offset: 3, length: 6 },
          ],
        }),
      );
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: 'msg-001',
        status: 'accepted',
      });
    });

    it('should reject when mentions validation fails', async () => {
      const socket = createMockSocket('user-sender');
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });
      membership.listActiveMemberIds.mockResolvedValue([]);

      await handler.handleSend(
        socket,
        makeSendPayload({
          body: 'Hi @stranger',
          mentions: [
            {
              user_id: 'user-stranger',
              mention_type: 'user',
              offset: 3,
              length: 9,
            },
          ],
        }),
      );

      expect(kafka.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(WsEvents.ChatAck, {
        message_id: 'msg-001',
        status: 'rejected',
        reason: 'mention_target_not_member',
      });
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
      membership.canUserSendMessage.mockResolvedValue({
        allowed: false,
        reason: 'not_member',
      });

      await handler.handleSend(socket, body);

      expect(membership.canUserSendMessage).toHaveBeenCalledWith(
        'real-user-id',
        'private-conv',
      );
    });

    it('should set sender_id from socket, not from payload', async () => {
      const socket = createMockSocket('server-verified-user');
      const body = makeSendPayload();
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleSend(socket, body);

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.ChatMessageSend,
        expect.objectContaining({ sender_id: 'server-verified-user' }),
      );
    });

    it('should check membership for EVERY operation type', async () => {
      const socket = createMockSocket();
      membership.canUserAccessConversation.mockResolvedValue(true);
      membership.canUserSendMessage.mockResolvedValue({ allowed: true });

      await handler.handleJoin(socket, 'conv-001');
      await handler.handleSend(socket, makeSendPayload());
      await handler.handleEdit(socket, makeEditPayload());
      await handler.handleDelete(socket, makeDeletePayload());
      await handler.handleReact(socket, makeReactPayload());
      await handler.handleUnreact(socket, makeUnreactPayload());

      // handleSend now uses canUserSendMessage; all other operations use canUserAccessConversation
      expect(membership.canUserAccessConversation).toHaveBeenCalledTimes(5);
      expect(membership.canUserSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateMentions', () => {
    type ValidateMentionsFn = (
      mentions: WsMention[],
      conversationId: string,
      senderId: string,
      body: string,
    ) => Promise<{ normalized: MessageMention[]; error?: string }>;

    const callValidate = (
      mentions: WsMention[],
      conversationId: string,
      userId: string,
      body: string,
    ) =>
      (
        handler as unknown as { validateMentions: ValidateMentionsFn }
      ).validateMentions(mentions, conversationId, userId, body);

    it('should accept valid mentions of active members', async () => {
      membership.listActiveMemberIds.mockResolvedValue(['user-1']);

      const result = await callValidate(
        [{ user_id: 'user-1', mention_type: 'user', offset: 0, length: 5 }],
        'conv-1',
        'user-sender',
        'Hello world',
      );

      expect(result.error).toBeUndefined();
      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].user_id).toBe('user-1');
    });

    it('should reject mention of a non-member', async () => {
      membership.listActiveMemberIds.mockResolvedValue([]);

      const result = await callValidate(
        [{ user_id: 'user-evil', mention_type: 'user', offset: 0, length: 5 }],
        'conv-1',
        'user-sender',
        'Hello world',
      );

      expect(result.error).toBe('mention_target_not_member');
    });

    it('should allow @Zai mention even when Zai is not a formal member', async () => {
      membership.listActiveMemberIds.mockResolvedValue([]);

      const result = await callValidate(
        [
          {
            user_id: 'zai-bot-user-id',
            mention_type: 'user',
            offset: 0,
            length: 4,
          },
        ],
        'conv-group',
        'user-sender',
        '@Zai hello',
      );

      expect(result.error).toBeUndefined();
      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].user_id).toBe('zai-bot-user-id');
      expect(membership.listActiveMemberIds).not.toHaveBeenCalled();
    });

    it('should reject @all in a direct (1-1) conversation', async () => {
      membership.getCachedConversationType.mockResolvedValue(ConversationType.DIRECT);

      const result = await callValidate(
        [{ user_id: '__ALL__', mention_type: 'all', offset: 0, length: 4 }],
        'conv-direct',
        'user-sender',
        '@all hello',
      );

      expect(result.error).toBe('at_all_in_direct_chat_disallowed');
    });

    it('should silently strip self-mention without rejecting', async () => {
      const result = await callValidate(
        [
          {
            user_id: 'user-sender',
            mention_type: 'user',
            offset: 0,
            length: 5,
          },
        ],
        'conv-1',
        'user-sender',
        'Hello',
      );

      expect(result.error).toBeUndefined();
      expect(result.normalized).toHaveLength(0);
    });

    it('should dedupe duplicate user_ids', async () => {
      membership.listActiveMemberIds.mockResolvedValue(['user-1']);

      const result = await callValidate(
        [
          { user_id: 'user-1', mention_type: 'user', offset: 0, length: 5 },
          { user_id: 'user-1', mention_type: 'user', offset: 10, length: 5 },
        ],
        'conv-1',
        'user-sender',
        'Hello world Hello world',
      );

      expect(result.error).toBeUndefined();
      expect(result.normalized).toHaveLength(1);
    });

    it('should reject when offset+length exceeds body length', async () => {
      const result = await callValidate(
        [{ user_id: 'user-1', mention_type: 'user', offset: 100, length: 5 }],
        'conv-1',
        'user-sender',
        'short',
      );

      expect(result.error).toBe('mention_offset_out_of_bounds');
    });

    it('should return conversation_not_found when @all targets a missing conversation', async () => {
      membership.getCachedConversationType.mockResolvedValue(null);

      const result = await callValidate(
        [{ user_id: '__ALL__', mention_type: 'all', offset: 0, length: 4 }],
        'conv-missing',
        'user-sender',
        '@all hello',
      );

      expect(result.error).toBe('conversation_not_found');
    });

    it('should reject negative offset', async () => {
      const result = await callValidate(
        [{ user_id: 'user-1', mention_type: 'user', offset: -1, length: 5 }],
        'conv-1',
        'user-sender',
        'Hello world',
      );

      expect(result.error).toBe('mention_offset_out_of_bounds');
    });

    it('should reject zero or negative length', async () => {
      const result = await callValidate(
        [{ user_id: 'user-1', mention_type: 'user', offset: 0, length: 0 }],
        'conv-1',
        'user-sender',
        'Hello',
      );

      expect(result.error).toBe('mention_offset_out_of_bounds');
    });

    it('should reject @all when rate-limit exceeded', async () => {
      membership.getCachedConversationType.mockResolvedValue(ConversationType.GROUP);
      redisService.incrBy.mockResolvedValue(4); // over limit of 3

      const result = await callValidate(
        [{ user_id: '__ALL__', mention_type: 'all', offset: 0, length: 4 }],
        'conv-1',
        'user-sender',
        '@all hello',
      );

      expect(result.error).toBe('at_all_rate_limited');
    });

    it('should allow @all when under rate-limit threshold', async () => {
      membership.getCachedConversationType.mockResolvedValue(ConversationType.GROUP);
      redisService.incrBy.mockResolvedValue(2);

      const result = await callValidate(
        [{ user_id: '__ALL__', mention_type: 'all', offset: 0, length: 4 }],
        'conv-1',
        'user-sender',
        '@all hello',
      );

      expect(result.error).toBeUndefined();
      expect(result.normalized).toHaveLength(1);
    });
  });
});
