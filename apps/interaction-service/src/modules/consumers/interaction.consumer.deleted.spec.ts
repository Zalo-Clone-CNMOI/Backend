import { Test, TestingModule } from '@nestjs/testing';
import { InteractionConsumer } from './interaction.consumer';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type {
  ChatMessageCreatedEvent,
  ChatMessageUpdatedEvent,
  ChatMessageDeletedEvent,
} from '@libs/contracts';

describe('InteractionConsumer onChatMessageDeleted', () => {
  let consumer: InteractionConsumer;
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InteractionConsumer],
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    consumer = module.get<InteractionConsumer>(InteractionConsumer);
  });

  const event: ChatMessageDeletedEvent = {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    deleted_at: 4000,
  };

  it('should clear body and attachments when deleted message is cached latest', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Visible text',
        created_at: 1000,
        has_attachments: true,
        message_type: 'video',
        last_event_at: 3000,
        last_event_type: 'updated',
      }),
    );

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).toHaveBeenCalledWith(
      'conversation:last:conv-1',
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: '',
        created_at: 1000,
        has_attachments: false,
        message_type: 'deleted',
        last_event_at: 4000,
        last_event_type: 'deleted',
      }),
    );
  });

  it('should skip stale delete when deleted_at is older than latest applied event', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: '',
        created_at: 1000,
        has_attachments: false,
        last_event_at: 5000,
        last_event_type: 'deleted',
      }),
    );

    await consumer.onChatMessageDeleted({
      ...event,
      deleted_at: 4500,
    });

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should allow equal timestamp delete when previous state is updated', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Edited',
        created_at: 1000,
        has_attachments: false,
        last_event_at: 4000,
        last_event_type: 'updated',
      }),
    );

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'conversation:last:conv-1',
      expect.stringContaining('"last_event_type":"deleted"'),
    );
  });

  it('should skip equal timestamp delete when previous state is already deleted', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: '',
        created_at: 1000,
        has_attachments: false,
        last_event_at: 4000,
        last_event_type: 'deleted',
      }),
    );

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip delete when event is not for latest cached message', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-other',
        sender_id: 'user-9',
        body: 'Latest body',
        created_at: 2000,
        has_attachments: false,
      }),
    );

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip delete when cache is missing', async () => {
    redis.get.mockResolvedValue(null);

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip delete when cache JSON is malformed and cleanup key', async () => {
    redis.get.mockResolvedValue('{invalid-json');

    await consumer.onChatMessageDeleted(event);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
  });

  it('should not throw when malformed-cache cleanup fails', async () => {
    redis.get.mockResolvedValue('{invalid-json');
    redis.del.mockRejectedValue(new Error('Redis DEL failed'));

    await expect(consumer.onChatMessageDeleted(event)).resolves.not.toThrow();

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
  });

  it('should keep projection consistent across create update delete sequence', async () => {
    redis.get.mockResolvedValue(null);

    const created: ChatMessageCreatedEvent = {
      message_id: 'msg-seq',
      conversation_id: 'conv-seq',
      sender_id: 'user-seq',
      body: 'Initial',
      created_at: 1000,
    };
    await consumer.onChatMessageCreated(created);

    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-seq',
        sender_id: 'user-seq',
        body: 'Initial',
        created_at: 1000,
        has_attachments: false,
        message_type: 'text',
        last_event_at: 1000,
        last_event_type: 'created',
      }),
    );

    const updated: ChatMessageUpdatedEvent = {
      message_id: 'msg-seq',
      conversation_id: 'conv-seq',
      sender_id: 'user-seq',
      body: 'Updated',
      edited_at: 2000,
    };
    await consumer.onChatMessageUpdated(updated);

    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-seq',
        sender_id: 'user-seq',
        body: 'Updated',
        created_at: 1000,
        has_attachments: false,
        message_type: 'text',
        last_event_at: 2000,
        last_event_type: 'updated',
      }),
    );

    await consumer.onChatMessageDeleted({
      message_id: 'msg-seq',
      conversation_id: 'conv-seq',
      sender_id: 'user-seq',
      deleted_at: 3000,
    });

    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      'conversation:last:conv-seq',
      JSON.stringify({
        message_id: 'msg-seq',
        sender_id: 'user-seq',
        body: 'Initial',
        created_at: 1000,
        has_attachments: false,
        message_type: 'text',
        last_event_at: 1000,
        last_event_type: 'created',
      }),
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      'conversation:last:conv-seq',
      JSON.stringify({
        message_id: 'msg-seq',
        sender_id: 'user-seq',
        body: 'Updated',
        created_at: 1000,
        has_attachments: false,
        message_type: 'text',
        last_event_at: 2000,
        last_event_type: 'updated',
      }),
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      3,
      'conversation:last:conv-seq',
      JSON.stringify({
        message_id: 'msg-seq',
        sender_id: 'user-seq',
        body: '',
        created_at: 1000,
        has_attachments: false,
        message_type: 'deleted',
        last_event_at: 3000,
        last_event_type: 'deleted',
      }),
    );
  });
});
