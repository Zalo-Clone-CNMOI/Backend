import type {
  AiConversationContext,
  AiConversationFeature,
  AiMessageFeature,
} from './ai-conversation';

describe('ai-conversation types', () => {
  it('AiConversationContext requires feature and created_at', () => {
    const ctx: AiConversationContext = {
      feature: 'document',
      document_id: 'doc-1',
      created_at: 1_700_000_000_000,
    };
    expect(ctx.feature).toBe('document');
  });

  it('AiConversationFeature is a strict subset of AiMessageFeature', () => {
    // Type-level assertion: every AiConversationFeature must be assignable to AiMessageFeature
    const f: AiConversationFeature = 'document';
    const m: AiMessageFeature = f; // must compile
    expect(m).toBe('document');
  });

  it('AiMessageFeature accepts all four message kinds', () => {
    const features: AiMessageFeature[] = [
      'document',
      'translation',
      'summary',
      'general',
    ];
    expect(features).toHaveLength(4);
  });
});
