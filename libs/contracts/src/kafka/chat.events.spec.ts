import { KafkaTopics } from './topics';
import type { ChatAiMessageCommand, AiMessageMetadata } from './chat.events';
import type { AiConversationContext } from '../types/ai-conversation';

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

  it('AiConversationContext requires feature and created_at', () => {
    const ctx: AiConversationContext = {
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1_700_000_000_000,
    };
    expect(ctx.feature).toBe('document');
  });
});
