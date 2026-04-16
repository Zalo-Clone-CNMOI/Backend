import { Test, TestingModule } from '@nestjs/testing';
import { InteractionConsumer } from './interaction.consumer';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { ChatMessageUpdatedEvent } from '@libs/contracts';

describe('InteractionConsumer onChatMessageUpdated', () => {
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

  const event: ChatMessageUpdatedEvent = {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    body: 'Edited body',
    edited_at: 3000,
  };

  it('should update cached latest body when message id matches', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Old body',
        created_at: 1000,
        has_attachments: true,
        message_type: 'video',
        last_event_at: 1000,
        last_event_type: 'created',
      }),
    );

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).toHaveBeenCalledWith(
      'conversation:last:conv-1',
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Edited body',
        created_at: 1000,
        has_attachments: true,
        message_type: 'video',
        last_event_at: 3000,
        last_event_type: 'updated',
      }),
    );
  });

  it('should skip stale update when edited_at is older than latest applied event', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Newest body',
        created_at: 1000,
        has_attachments: true,
        last_event_at: 5000,
        last_event_type: 'updated',
      }),
    );

    await consumer.onChatMessageUpdated({
      ...event,
      edited_at: 4000,
      body: 'Stale edit',
    });

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should allow equal timestamp update when previous state is created', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Created body',
        created_at: 3000,
        has_attachments: false,
        last_event_at: 3000,
        last_event_type: 'created',
      }),
    );

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'conversation:last:conv-1',
      expect.stringContaining('"last_event_type":"updated"'),
    );
  });

  it('should skip equal timestamp update when previous state is deleted', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: '',
        created_at: 1000,
        has_attachments: false,
        last_event_at: 3000,
        last_event_type: 'deleted',
      }),
    );

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip update when event is not for latest cached message', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-latest',
        sender_id: 'user-9',
        body: 'Latest body',
        created_at: 2000,
        has_attachments: false,
        last_event_at: 2000,
        last_event_type: 'created',
      }),
    );

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip update when cache is missing', async () => {
    redis.get.mockResolvedValue(null);

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip update when cache JSON is malformed and cleanup key', async () => {
    redis.get.mockResolvedValue('{invalid-json');

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
  });

  it('should not throw when malformed-cache cleanup fails', async () => {
    redis.get.mockResolvedValue('{invalid-json');
    redis.del.mockRejectedValue(new Error('Redis DEL failed'));

    await expect(consumer.onChatMessageUpdated(event)).resolves.not.toThrow();

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
  });

  it('should skip update when cache shape is invalid and cleanup key', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: [],
        body: 123,
      }),
    );

    await consumer.onChatMessageUpdated(event);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
  });
});
