import type { LlmChatMessage, LlmContentPart } from '../interfaces';

/** Placeholder substituted for image parts when a provider lacks vision. */
const IMAGE_PLACEHOLDER = '[hình ảnh / image]';

/**
 * Flatten multimodal content to plain text. Used by providers that do not
 * implement vision (OpenAI/Anthropic/Gemini are text-only here — LocDo is the
 * vision path); image parts are replaced with a placeholder so the request
 * stays valid and the conversation context is preserved.
 */
export function flattenContentToText(
  content: string | LlmContentPart[],
): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : IMAGE_PLACEHOLDER))
    .join('\n');
}

/** Return a copy of `messages` with every content flattened to a string. */
export function flattenMessages(messages: LlmChatMessage[]): LlmChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: flattenContentToText(m.content),
  }));
}
