import { KafkaTopics } from './topics';
import type { ChatAiMessageCommand, AiMessageMetadata } from './chat.events';

describe('Zai contracts', () => {
  it('exposes chat.ai.message topic constant', () => {
    expect(KafkaTopics.ChatAiMessage).toBe('chat.ai.message');
  });

  it('ChatAiMessageCommand type is structurally complete', () => {
    const cmd: ChatAiMessageCommand = {
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'zai-bot-id',
      body: 'Hello from Zai',
      created_at: 1_700_000_000_000,
      trace_id: 'trace-1',
    };
    expect(cmd.sender_id).toBe('zai-bot-id');
  });

  it('AiMessageMetadata supports document feature with sources', () => {
    const meta: AiMessageMetadata = {
      feature: 'document',
      sources: [{ chunk_index: 0, preview: 'snippet' }],
      tokens_used: 123,
      model: 'claude-sonnet-4-6',
    };
    expect(meta.feature).toBe('document');
    expect(meta.sources?.[0]?.chunk_index).toBe(0);
  });

  it('ChatAiMessageCommand accepts attachments and metadata', () => {
    const cmd: ChatAiMessageCommand = {
      message_id: 'm1',
      conversation_id: 'c1',
      sender_id: 'zai',
      body: 'see attached',
      attachments: [
        {
          key: 'uploads/a.jpg',
          type: 'image',
          name: 'a.jpg',
          size: 100,
          content_type: 'image/jpeg',
        },
      ],
      metadata: { feature: 'document', tokens_used: 50 },
      created_at: 1_700_000_000_000,
      trace_id: 't1',
    };
    expect(cmd.attachments?.[0]?.type).toBe('image');
    expect(cmd.metadata?.feature).toBe('document');
  });
});
