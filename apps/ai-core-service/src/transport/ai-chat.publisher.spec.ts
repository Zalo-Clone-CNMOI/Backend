import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { KAFKA_CLIENT } from '@libs/kafka';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { KafkaTopics, type ChatAiMessageCommand } from '@libs/contracts';
import { AiChatPublisher } from './ai-chat.publisher';

describe('AiChatPublisher', () => {
  const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';
  let publisher: AiChatPublisher;
  let kafka: { emit: jest.Mock; connect: jest.Mock; close: jest.Mock };
  let config: Partial<AppConfig>;

  beforeEach(async () => {
    kafka = {
      emit: jest.fn().mockReturnValue(of(undefined)),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    config = { zaiBotUserId: ZAI_ID, serviceName: 'ai-core-service' };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiChatPublisher,
        { provide: KAFKA_CLIENT, useValue: kafka },
        { provide: APP_CONFIG, useValue: config },
      ],
    }).compile();

    publisher = moduleRef.get(AiChatPublisher);
  });

  it('publishes to chat.ai.message with sender_id from config', async () => {
    await publisher.send({
      message_id: 'm1',
      conversation_id: 'c1',
      body: 'Hello from Zai',
      trace_id: 't1',
    });

    expect(kafka.emit).toHaveBeenCalledWith(
      KafkaTopics.ChatAiMessage,
      expect.objectContaining({
        message_id: 'm1',
        conversation_id: 'c1',
        sender_id: ZAI_ID,
        body: 'Hello from Zai',
        trace_id: 't1',
      }),
    );
  });

  it('injects created_at when caller omits it', async () => {
    const before = Date.now();
    await publisher.send({
      message_id: 'm2',
      conversation_id: 'c2',
      body: 'hi',
      trace_id: 't2',
    });
    const after = Date.now();

    const firstCall = kafka.emit.mock.calls[0] as [
      string,
      ChatAiMessageCommand,
    ];
    const payload = firstCall[1];
    expect(payload.created_at).toBeGreaterThanOrEqual(before);
    expect(payload.created_at).toBeLessThanOrEqual(after);
  });

  it('forwards attachments and metadata when provided', async () => {
    await publisher.send({
      message_id: 'm3',
      conversation_id: 'c3',
      body: 'see attached',
      trace_id: 't3',
      attachments: [
        {
          key: 'uploads/y.jpg',
          type: 'image',
          name: 'y.jpg',
          size: 123,
          content_type: 'image/jpeg',
        },
      ],
      metadata: { feature: 'document', tokens_used: 42 },
    });

    const firstCall = kafka.emit.mock.calls[0] as [
      string,
      ChatAiMessageCommand,
    ];
    const payload = firstCall[1];
    expect(payload.attachments).toEqual([
      {
        key: 'uploads/y.jpg',
        type: 'image',
        name: 'y.jpg',
        size: 123,
        content_type: 'image/jpeg',
      },
    ]);
    expect(payload.metadata).toEqual({ feature: 'document', tokens_used: 42 });
  });

  it('forwards body_format when provided', async () => {
    await publisher.send({
      message_id: 'm4',
      conversation_id: 'c4',
      body: '**styled** body',
      trace_id: 't4',
      body_format: 'markdown',
    });

    const payload = kafka.emit.mock.calls[0][1] as ChatAiMessageCommand;
    expect(payload.body_format).toBe('markdown');
  });

  it('omits body_format when not provided (frontend defaults to text)', async () => {
    await publisher.send({
      message_id: 'm5',
      conversation_id: 'c5',
      body: 'plain hello',
      trace_id: 't5',
    });

    const payload = kafka.emit.mock.calls[0][1] as ChatAiMessageCommand;
    expect(payload.body_format).toBeUndefined();
  });

  it('propagates errors from kafka publish', async () => {
    // Use fake timers to flush retry backoff delays (backoffBaseMs=1000, maxRetries=3)
    // without waiting for real wall-clock time.
    jest.useFakeTimers();

    const { throwError } = await import('rxjs');
    // mockReturnValue (not Once) — defer() re-calls emit on every retry attempt,
    // and emitToDlq also calls emit once more for the DLQ topic. All must throw.
    kafka.emit.mockReturnValue(throwError(() => new Error('broker down')));

    const sendPromise = publisher.send({
      message_id: 'm-err',
      conversation_id: 'c-err',
      body: 'fails',
      trace_id: 't-err',
    });

    // Advance timers to flush all retry backoff delays in one shot
    void jest.runAllTimersAsync();

    await expect(sendPromise).rejects.toThrow(/broker down/);

    jest.useRealTimers();
  });
});
