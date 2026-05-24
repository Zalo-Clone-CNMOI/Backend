import { Conversation } from './conversation.entity';
import { ConversationType } from '@app/constant';

describe('Conversation.aiContext', () => {
  it('is nullable by default', () => {
    const conv = new Conversation();
    conv.type = ConversationType.GROUP;
    expect(conv.aiContext).toBeUndefined();
  });

  it('accepts an AI context object', () => {
    const conv = new Conversation();
    conv.type = ConversationType.AI_ASSISTANT;
    conv.aiContext = {
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1_700_000_000_000,
    };
    expect(conv.aiContext?.feature).toBe('document');
    expect(conv.aiContext?.document_id).toBe('doc-1');
  });
});
