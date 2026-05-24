import { ConversationType } from './enum';

describe('ConversationType', () => {
  it('includes the Zai AI_ASSISTANT variant', () => {
    expect(ConversationType.AI_ASSISTANT).toBe('ai_assistant');
  });

  it('preserves existing DIRECT and GROUP variants', () => {
    expect(ConversationType.DIRECT).toBe('direct');
    expect(ConversationType.GROUP).toBe('group');
  });

  it('has exactly three variants', () => {
    expect(Object.values(ConversationType).sort()).toEqual([
      'ai_assistant',
      'direct',
      'group',
    ]);
  });
});
