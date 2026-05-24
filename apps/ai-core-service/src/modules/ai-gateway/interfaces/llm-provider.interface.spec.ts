import type { LlmChatMessage, LlmContentPart } from './llm-provider.interface';

describe('LlmChatMessage multimodal', () => {
  it('accepts plain string content (backward compat)', () => {
    const msg: LlmChatMessage = { role: 'user', content: 'hello' };
    expect(typeof msg.content).toBe('string');
  });

  it('accepts array of text parts', () => {
    const msg: LlmChatMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'describe this' }],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it('accepts array with image_url part', () => {
    const part: LlmContentPart = {
      type: 'image_url',
      url: 'https://example.com/img.jpg',
      mime_type: 'image/jpeg',
    };
    const msg: LlmChatMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'what is this?' }, part],
    };
    expect((msg.content as LlmContentPart[]).length).toBe(2);
  });
});
