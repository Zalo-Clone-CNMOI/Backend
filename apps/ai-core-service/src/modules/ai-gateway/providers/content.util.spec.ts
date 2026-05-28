import { flattenContentToText, flattenMessages } from './content.util';
import type { LlmChatMessage } from '../interfaces';

describe('flattenContentToText', () => {
  it('returns plain string content unchanged', () => {
    expect(flattenContentToText('hello')).toBe('hello');
  });

  it('joins text parts and replaces image parts with a placeholder', () => {
    const out = flattenContentToText([
      { type: 'text', text: 'look at this' },
      { type: 'image_url', url: 'https://s3/x.png' },
    ]);
    expect(out).toContain('look at this');
    expect(out).toContain('[hình ảnh / image]');
    expect(out).not.toContain('https://s3/x.png');
  });

  it('handles image-only content (no text part)', () => {
    const out = flattenContentToText([{ type: 'image_url', url: 'u' }]);
    expect(out).toBe('[hình ảnh / image]');
  });
});

describe('flattenMessages', () => {
  it('flattens every message content to a string', () => {
    const messages: LlmChatMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'q' },
          { type: 'image_url', url: 'https://s3/i.png' },
        ],
      },
    ];

    const out = flattenMessages(messages);

    expect(typeof out[0].content).toBe('string');
    expect(typeof out[1].content).toBe('string');
    expect(out[1].content).toContain('q');
    expect(out[1].content).not.toContain('https://s3/i.png');
  });
});
