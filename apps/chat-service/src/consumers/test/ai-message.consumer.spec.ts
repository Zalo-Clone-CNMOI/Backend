import { APP_CONFIG, AppConfig } from '@libs/config';
import { KafkaTopics, type ChatAiMessageCommand } from '@libs/contracts';
import { AiMessageConsumer } from '../ai-message.consumer';

const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';

describe('AiMessageConsumer', () => {
  let consumer: AiMessageConsumer;
  let repo: {
    tryBeginMessageProcessing: jest.Mock;
    insertMessage: jest.Mock;
    markMessageStored: jest.Mock;
    clearMessageProcessing: jest.Mock;
  };
  let publisher: { emit: jest.Mock };
  let cache: { invalidateRecentMessages: jest.Mock };

  function buildPayload(overrides: Partial<ChatAiMessageCommand> = {}): ChatAiMessageCommand {
    return {
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: ZAI_ID,
      body: 'Hello from Zai',
      created_at: 1_700_000_000_000,
      trace_id: 'trace-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    repo = {
      tryBeginMessageProcessing: jest.fn().mockResolvedValue(true),
      insertMessage: jest.fn().mockResolvedValue(undefined),
      markMessageStored: jest.fn().mockResolvedValue(undefined),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
    };
    publisher = { emit: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidateRecentMessages: jest.fn().mockResolvedValue(undefined) };

    consumer = new AiMessageConsumer(
      repo as never,
      publisher as never,
      cache as never,
      { zaiBotUserId: ZAI_ID } as AppConfig,
    );
  });

  it('persists message and emits chat.message.created on happy path', async () => {
    await consumer.onAiMessage(buildPayload());

    expect(repo.tryBeginMessageProcessing).toHaveBeenCalledWith(
      'msg-1',
      'conv-1',
      1_700_000_000_000,
    );
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'msg-1',
        sender_id: ZAI_ID,
        body: 'Hello from Zai',
      }),
    );
    expect(publisher.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatMessageCreated,
      expect.objectContaining({ message_id: 'msg-1', sender_id: ZAI_ID }),
    );
    expect(repo.markMessageStored).toHaveBeenCalledWith('msg-1');
  });

  it('rejects messages with sender_id != zaiBotUserId', async () => {
    await consumer.onAiMessage(buildPayload({ sender_id: 'attacker-id' }));

    expect(repo.tryBeginMessageProcessing).not.toHaveBeenCalled();
    expect(repo.insertMessage).not.toHaveBeenCalled();
    expect(publisher.emit).not.toHaveBeenCalled();
  });

  it('skips processing when idempotency lock is already held (duplicate redelivery)', async () => {
    repo.tryBeginMessageProcessing.mockResolvedValueOnce(false);

    await consumer.onAiMessage(buildPayload());

    expect(repo.insertMessage).not.toHaveBeenCalled();
    expect(publisher.emit).not.toHaveBeenCalled();
  });

  it('forwards attachments and metadata into the created event', async () => {
    await consumer.onAiMessage(
      buildPayload({
        attachments: [{ key: 'uploads/x.jpg', type: 'image', name: 'x.jpg', size: 100, content_type: 'image/jpeg' }],
        metadata: { feature: 'document', tokens_used: 50 },
      }),
    );

    expect(publisher.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatMessageCreated,
      expect.objectContaining({
        attachments: [{ key: 'uploads/x.jpg', type: 'image', name: 'x.jpg', size: 100, content_type: 'image/jpeg' }],
      }),
    );
  });

  it('clears idempotency lock and rethrows when insert fails', async () => {
    repo.insertMessage.mockRejectedValueOnce(new Error('Scylla down'));

    await expect(consumer.onAiMessage(buildPayload())).rejects.toThrow(
      'Scylla down',
    );
    expect(repo.clearMessageProcessing).toHaveBeenCalledWith('msg-1');
  });
});
