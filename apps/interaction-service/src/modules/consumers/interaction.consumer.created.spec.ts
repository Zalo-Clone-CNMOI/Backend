import { Test, TestingModule } from '@nestjs/testing';
import { InteractionConsumer } from './interaction.consumer';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type { ChatMessageCreatedEvent } from '@libs/contracts';

describe('InteractionConsumer onChatMessageCreated', () => {
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

  const event: ChatMessageCreatedEvent = {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    body: 'Hello world',
    created_at: 1000,
    attachments: [
      {
        key: 'k1',
        type: 'image',
        name: 'a',
        size: 10,
        content_type: 'image/jpeg',
      },
    ],
  };

  it('should write snapshot when cache is empty', async () => {
    redis.get.mockResolvedValue(null);

    await consumer.onChatMessageCreated(event);

    expect(redis.set).toHaveBeenCalledWith(
      'conversation:last:conv-1',
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Hello world',
        created_at: 1000,
        has_attachments: true,
        last_event_at: 1000,
        last_event_type: 'created',
      }),
    );
  });

  it('should skip outdated created events when cache is newer', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-latest',
        sender_id: 'user-2',
        body: 'latest',
        created_at: 2000,
        has_attachments: false,
        last_event_at: 2000,
        last_event_type: 'created',
      }),
    );

    await consumer.onChatMessageCreated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip duplicate created events at equal timestamp', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: 'Hello world',
        created_at: 1000,
        has_attachments: true,
        last_event_at: 1000,
        last_event_type: 'created',
      }),
    );

    await consumer.onChatMessageCreated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should skip equal timestamp created when deleted state already exists', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 'msg-1',
        sender_id: 'user-1',
        body: '',
        created_at: 1000,
        has_attachments: false,
        last_event_at: 1000,
        last_event_type: 'deleted',
      }),
    );

    await consumer.onChatMessageCreated(event);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should recover from malformed cache JSON, cleanup and overwrite snapshot', async () => {
    redis.get.mockResolvedValue('{invalid-json');

    await consumer.onChatMessageCreated(event);

    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('should still overwrite snapshot when malformed-cache cleanup fails', async () => {
    redis.get.mockResolvedValue('{invalid-json');
    redis.del.mockRejectedValue(new Error('Redis DEL failed'));

    await expect(consumer.onChatMessageCreated(event)).resolves.not.toThrow();

    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('should cleanup invalid cache shape and overwrite snapshot', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        message_id: 123,
        created_at: 'bad',
      }),
    );

    await consumer.onChatMessageCreated(event);

    expect(redis.del).toHaveBeenCalledWith('conversation:last:conv-1');
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});
