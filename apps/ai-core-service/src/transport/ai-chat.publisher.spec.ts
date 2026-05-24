import { Test } from '@nestjs/testing';
import { ClientKafka } from '@nestjs/microservices';
import { of } from 'rxjs';
import { KAFKA_CLIENT } from '@libs/kafka';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { KafkaTopics } from '@libs/contracts';
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

    const payload = kafka.emit.mock.calls[0][1];
    expect(payload.created_at).toBeGreaterThanOrEqual(before);
    expect(payload.created_at).toBeLessThanOrEqual(after);
  });

  it('forwards attachments and metadata when provided', async () => {
    await publisher.send({
      message_id: 'm3',
      conversation_id: 'c3',
      body: 'see attached',
      trace_id: 't3',
      attachments: [{ key: 'uploads/y.jpg', type: 'image', name: 'y.jpg', size: 123, content_type: 'image/jpeg' }],
      metadata: { feature: 'document', tokens_used: 42 },
    });

    const payload = kafka.emit.mock.calls[0][1];
    expect(payload.attachments).toEqual([
      { key: 'uploads/y.jpg', type: 'image', name: 'y.jpg', size: 123, content_type: 'image/jpeg' },
    ]);
    expect(payload.metadata).toEqual({ feature: 'document', tokens_used: 42 });
  });
});
