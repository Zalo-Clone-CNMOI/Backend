import { MessageType } from '@app/constant';
import { ChatFanoutConsumer } from './chat-fanout.consumer';
import {
  SystemEventType,
  SystemMessageMetadata,
  WsEvents,
} from '@libs/contracts';
import type { ChatMessageCreatedEvent } from '@libs/contracts';

describe('ChatFanoutConsumer', () => {
  const gateway: {
    broadcastToConversation: jest.Mock<void, [string, string, unknown]>;
    emitToUser: jest.Mock<void, [string, string, unknown]>;
  } = {
    broadcastToConversation: jest.fn<void, [string, string, unknown]>(),
    emitToUser: jest.fn<void, [string, string, unknown]>(),
  };
  const conversationMemberRepo: {
    find: jest.Mock<Promise<Array<{ userId: string }>>, [unknown]>;
  } = {
    find: jest.fn<Promise<Array<{ userId: string }>>, [unknown]>(),
  };
  const friendshipAccess: {
    getFriendSet: jest.Mock<Promise<Set<string>>, [string, string[]]>;
  } = {
    getFriendSet: jest.fn<Promise<Set<string>>, [string, string[]]>(),
  };

  let consumer: ChatFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new ChatFanoutConsumer(
      gateway as never,
      conversationMemberRepo as never,
      friendshipAccess as never,
    );
  });

  it('should broadcast message to conversation when not forwarded', async () => {
    await consumer.onMessageCreated({
      message_id: 'msg-plain',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      body: 'hello',
      created_at: 1706162800000,
      trace_id: 'trace-plain',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessage,
      {
        message_id: 'msg-plain',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        body: 'hello',
        created_at: 1706162800000,
        attachments: undefined,
        reply_to_message_id: undefined,
        mentions: undefined,
      },
    );
    expect(conversationMemberRepo.find).not.toHaveBeenCalled();
    expect(friendshipAccess.getFriendSet).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('should include mentions in broadcast payload when present', async () => {
    await consumer.onMessageCreated({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'sender-1',
      body: 'Hi @user-1',
      created_at: 1700000000000,
      mentions: [
        { user_id: 'user-1', mention_type: 'user', offset: 3, length: 6 },
      ],
    } as unknown as ChatMessageCreatedEvent);

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessage,
      expect.objectContaining({
        mentions: [
          { user_id: 'user-1', mention_type: 'user', offset: 3, length: 6 },
        ],
      }),
    );
  });

  it('should omit mentions field when payload has no mentions (existing behavior unchanged)', async () => {
    await consumer.onMessageCreated({
      message_id: 'msg-2',
      conversation_id: 'conv-1',
      sender_id: 'sender-1',
      body: 'no mentions',
      created_at: 1700000000001,
    } as unknown as ChatMessageCreatedEvent);

    const args = gateway.broadcastToConversation.mock.calls[0][2] as {
      mentions?: unknown;
    };
    expect(args.mentions).toBeUndefined();
  });

  it('should emit forwarded message per member and hide forwarded_from for non-friends', async () => {
    conversationMemberRepo.find.mockResolvedValue([
      { userId: 'source-user' },
      { userId: 'friend-user' },
      { userId: 'stranger-user' },
    ]);
    friendshipAccess.getFriendSet.mockResolvedValue(new Set(['friend-user']));

    await consumer.onMessageCreated({
      message_id: 'msg-fwd',
      conversation_id: 'conv-2',
      sender_id: 'forwarder-user',
      body: 'fwd body',
      created_at: 1706162800000,
      forwarded_from: {
        source_message_id: 'src-msg',
        source_conversation_id: 'src-conv',
        source_sender_id: 'source-user',
        source_sender_name_snapshot: 'Source User',
        source_created_at: 1706162700000,
        source_type: 'text',
      },
      trace_id: 'trace-fwd',
    });

    expect(conversationMemberRepo.find).toHaveBeenCalledTimes(1);
    const [[findQuery]] = conversationMemberRepo.find.mock.calls as Array<
      [{ where: { conversationId: string; leftAt: unknown }; select: string[] }]
    >;
    expect(findQuery.where.conversationId).toBe('conv-2');
    expect(findQuery.select).toEqual(['userId']);
    expect(friendshipAccess.getFriendSet).toHaveBeenCalledWith('source-user', [
      'source-user',
      'friend-user',
      'stranger-user',
    ]);

    expect(gateway.emitToUser).toHaveBeenCalledTimes(3);
    const sourcePayload = gateway.emitToUser.mock.calls[0][2] as {
      forwarded_from?: { source_sender_id: string };
    };
    const friendPayload = gateway.emitToUser.mock.calls[1][2] as {
      forwarded_from?: { source_sender_id: string };
    };
    const strangerPayload = gateway.emitToUser.mock.calls[2][2] as {
      forwarded_from?: { source_sender_id: string };
    };

    expect(gateway.emitToUser.mock.calls[0][0]).toBe('source-user');
    expect(gateway.emitToUser.mock.calls[1][0]).toBe('friend-user');
    expect(gateway.emitToUser.mock.calls[2][0]).toBe('stranger-user');
    expect(sourcePayload.forwarded_from?.source_sender_id).toBe('source-user');
    expect(friendPayload.forwarded_from?.source_sender_id).toBe('source-user');
    expect(strangerPayload.forwarded_from).toBeUndefined();
    expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
  });

  it('should broadcast message pinned payload to conversation room', () => {
    consumer.onMessagePinned({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1706162800000,
      pinned_by: 'user-1',
      pinned_at: 1706162900000,
      trace_id: 'trace-pin-1',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessagePinned,
      {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        created_at: 1706162800000,
        pinned_by: 'user-1',
        pinned_at: 1706162900000,
      },
    );
  });

  it('should broadcast message unpinned payload to conversation room', () => {
    consumer.onMessageUnpinned({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1706162800000,
      unpinned_by: 'user-2',
      unpinned_at: 1706163000000,
      trace_id: 'trace-unpin-1',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatMessageUnpinned,
      {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        created_at: 1706162800000,
        unpinned_by: 'user-2',
        unpinned_at: 1706163000000,
      },
    );
  });

  it('should broadcast system message payload to conversation room', () => {
    consumer.onSystemMessageCreated({
      message_id: 'sys-msg-1',
      conversation_id: 'conv-1',
      message_type: 'system' as MessageType.SYSTEM,
      system_event_type: 'member_added' as SystemEventType,
      metadata: { added_by: '1' } as SystemMessageMetadata,
      body: 'A member joined',
      created_at: 1706162800000,
      trace_id: 'trace-sys-msg-1',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ChatSystemMessage,
      {
        message_id: 'sys-msg-1',
        conversation_id: 'conv-1',
        message_type: 'system',
        system_event_type: 'member_added',
        metadata: { added_by: '1' },
        body: 'A member joined',
        created_at: 1706162800000,
      },
    );
  });
});
