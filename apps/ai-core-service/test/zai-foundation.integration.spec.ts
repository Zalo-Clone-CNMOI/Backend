import { of } from 'rxjs';
import {
  KafkaTopics,
  type ChatAiMessageCommand,
  type ChatMessageCreatedEvent,
} from '@libs/contracts';
import { type AppConfig } from '@libs/config';
import { AiChatPublisher } from '../src/transport/ai-chat.publisher';
import { AiMessageConsumer } from '../../chat-service/src/consumers/ai-message.consumer';

const ZAI_ID = '00000000-0000-0000-0000-0000000000a1';

describe('Zai foundation integration', () => {
  it('end-to-end: publisher emits → consumer persists → chat.message.created produced', async () => {
    // Capture what the publisher emits to Kafka
    const kafkaTransport: Array<{ topic: string; payload: unknown }> = [];

    // Fake Kafka client used by publisher (must match the rxjs Observable contract publishKafkaWithRetry expects)
    const fakeKafka = {
      emit: jest.fn((topic: string, payload: unknown) => {
        kafkaTransport.push({ topic, payload });
        return of(undefined);
      }),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const publisher = new AiChatPublisher(
      fakeKafka as never,
      { zaiBotUserId: ZAI_ID, serviceName: 'ai-core-service' } as AppConfig,
    );

    // Consumer-side fakes
    const inserted: Array<Record<string, unknown>> = [];
    const emittedEvents: Array<{ topic: string; payload: unknown }> = [];

    const fakeRepo = {
      tryBeginMessageProcessing: jest.fn().mockResolvedValue(true),
      insertMessage: jest.fn(async (m: Record<string, unknown>) => {
        inserted.push(m);
      }),
      markMessageStored: jest.fn().mockResolvedValue(undefined),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
    };

    const fakePublisher = {
      emit: jest.fn(async (topic: string, payload: unknown) => {
        emittedEvents.push({ topic, payload });
      }),
    };

    const fakeCache = {
      invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    const consumer = new AiMessageConsumer(
      fakeRepo as never,
      fakePublisher as never,
      fakeCache as never,
      { zaiBotUserId: ZAI_ID } as AppConfig,
    );

    // ── ACT ─────────────────────────────────────────────────────
    await publisher.send({
      message_id: 'msg-int-1',
      conversation_id: 'conv-int-1',
      body: 'Integration test',
      trace_id: 'trace-int-1',
    });

    // Pluck Kafka payload from transport and route to consumer
    expect(kafkaTransport).toHaveLength(1);
    expect(kafkaTransport[0].topic).toBe(KafkaTopics.ChatAiMessage);
    const aiMessagePayload = kafkaTransport[0].payload as ChatAiMessageCommand;

    await consumer.onAiMessage(aiMessagePayload);

    // ── ASSERT ──────────────────────────────────────────────────
    // 1. ScyllaDB insert occurred with Zai as sender
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      message_id: 'msg-int-1',
      conversation_id: 'conv-int-1',
      sender_id: ZAI_ID,
      body: 'Integration test',
    });

    // 2. chat.message.created was emitted (no new WS event needed)
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].topic).toBe(KafkaTopics.ChatMessageCreated);
    const created = emittedEvents[0].payload as ChatMessageCreatedEvent;
    expect(created.sender_id).toBe(ZAI_ID);
    expect(created.message_id).toBe('msg-int-1');
    expect(created.trace_id).toBe('trace-int-1');
  });

  it('rejects forged Zai message and produces nothing downstream', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const emittedEvents: Array<{ topic: string; payload: unknown }> = [];

    const fakeRepo = {
      tryBeginMessageProcessing: jest.fn().mockResolvedValue(true),
      insertMessage: jest.fn(async (m: Record<string, unknown>) =>
        inserted.push(m),
      ),
      markMessageStored: jest.fn().mockResolvedValue(undefined),
      clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
    };
    const fakePublisher = {
      emit: jest.fn(async (topic: string, payload: unknown) =>
        emittedEvents.push({ topic, payload }),
      ),
    };
    const fakeCache = {
      invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    };

    const consumer = new AiMessageConsumer(
      fakeRepo as never,
      fakePublisher as never,
      fakeCache as never,
      { zaiBotUserId: ZAI_ID } as AppConfig,
    );

    const forged: ChatAiMessageCommand = {
      message_id: 'forged-1',
      conversation_id: 'conv-1',
      sender_id: 'attacker-id', // ← not Zai
      body: 'inject',
      created_at: Date.now(),
      trace_id: 't-forged',
    };

    await consumer.onAiMessage(forged);

    expect(inserted).toHaveLength(0);
    expect(emittedEvents).toHaveLength(0);
  });
});
