import { Test, TestingModule } from '@nestjs/testing';
import { InteractionConsumer } from './interaction.consumer';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import type {
  ChatMessageCreatedEvent,
  ChatMessageUpdatedEvent,
  ChatMessageDeletedEvent,
} from '@libs/contracts';

describe('InteractionConsumer', () => {
  let consumer: InteractionConsumer;
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InteractionConsumer],
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    consumer = module.get<InteractionConsumer>(InteractionConsumer);
  });

  describe('onChatMessageCreated', () => {
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
        }),
      );

      await consumer.onChatMessageCreated(event);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('should recover from malformed cache JSON and overwrite snapshot', async () => {
      redis.get.mockResolvedValue('{invalid-json');

      await consumer.onChatMessageCreated(event);

      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        'conversation:last:conv-1',
        expect.stringContaining('"message_id":"msg-1"'),
      );
    });
  });

  describe('onChatMessageUpdated', () => {
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
        }),
      );
    });

    it('should skip update when event is not for latest cached message', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          message_id: 'msg-latest',
          sender_id: 'user-9',
          body: 'Latest body',
          created_at: 2000,
          has_attachments: false,
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

    it('should skip update when cache JSON is malformed', async () => {
      redis.get.mockResolvedValue('{invalid-json');

      await consumer.onChatMessageUpdated(event);

      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('onChatMessageDeleted', () => {
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
        }),
      );
    });

    it('should skip delete when event is not for latest cached message', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          message_id: 'msg-latest',
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

    it('should skip delete when cache JSON is malformed', async () => {
      redis.get.mockResolvedValue('{invalid-json');

      await consumer.onChatMessageDeleted(event);

      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
