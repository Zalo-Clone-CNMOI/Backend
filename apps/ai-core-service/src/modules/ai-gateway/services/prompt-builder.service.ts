import { Injectable, Logger } from '@nestjs/common';
import { LlmChatMessage } from '../interfaces';

export interface SmartReplyContextMessage {
  role: 'me' | 'them';
  body: string;
}

// Static prefix — placed first in system prompts so OpenAI/LocDo prefix caching
// can cache this block across requests. Dynamic context (app context) goes last.
const LANGUAGE_RULE =
  'Respond in the same language as the user. If the user writes in Vietnamese, reply in Vietnamese.';

const APP_CONTEXT =
  'You are an AI assistant embedded in a Vietnamese chat application (similar to Zalo). Users send casual messages in Vietnamese or English.';

// Vietnamese diacritics regex — used to pick label language for context blocks
// so labels match the conversation language (avoid Vietnamese labels around English content)
const VI_DIACRITICS_RE =
  /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;

function looksVietnamese(...samples: string[]): boolean {
  for (const s of samples) {
    if (s && VI_DIACRITICS_RE.test(s)) return true;
  }
  return false;
}

@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  buildModerationPrompt(messageBody: string): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `${APP_CONTEXT}
Your task: classify chat messages for content moderation. Messages may be in Vietnamese or English.
${LANGUAGE_RULE}

Return a JSON object with:
- "is_flagged": boolean (true if the message is harmful)
- "labels": array of applicable labels from: ["clean", "spam", "toxic", "harassment", "hate_speech", "sexual", "violence", "self_harm"]
- "confidence": number between 0 and 1

Respond ONLY with the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: messageBody,
      },
    ];
  }

  buildSmartReplyPrompt(
    lastMessage: string,
    contextMessages: SmartReplyContextMessage[],
  ): LlmChatMessage[] {
    const isVi = looksVietnamese(
      lastMessage,
      ...contextMessages.map((m) => m.body),
    );
    const labels = isVi
      ? {
          history: 'Lịch sử cuộc trò chuyện',
          me: 'Bạn',
          them: 'Họ',
          last: 'Tin nhắn cuối',
        }
      : {
          history: 'Recent conversation',
          me: 'You',
          them: 'Them',
          last: 'Last message',
        };

    const contextBlock = contextMessages.length
      ? `${labels.history}:\n${contextMessages.map((m) => `${m.role === 'me' ? labels.me : labels.them}: ${m.body}`).join('\n')}\n\n`
      : '';

    return [
      {
        role: 'system',
        content: `${APP_CONTEXT}
Your task: suggest 3 short, natural reply options for the last message in a chat conversation.
${LANGUAGE_RULE}

Rules:
- Each suggestion must be under 80 characters
- Suggestions must feel natural for a casual chat (not formal or robotic)
- Match the tone and language of the conversation

Return a JSON object with:
- "suggestions": array of exactly 3 strings

Respond ONLY with the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: `${contextBlock}${labels.last}: "${lastMessage}"`,
      },
    ];
  }

  buildSummaryPrompt(messages: string[]): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `${APP_CONTEXT}
Your task: summarize a group of chat messages clearly and concisely.
${LANGUAGE_RULE}

Focus on: main topics discussed, any decisions made, action items mentioned.
Keep the summary under 200 words. Write in a neutral, informative tone.

Return a JSON object with:
- "summary": string

Respond ONLY with the JSON object.`,
      },
      {
        role: 'user',
        content: messages.join('\n'),
      },
    ];
  }

  buildTranslationPrompt(
    text: string,
    sourceLanguage: string | undefined,
    targetLanguage: string,
  ): LlmChatMessage[] {
    const sourcePart = sourceLanguage ? `from ${sourceLanguage} ` : '';

    return [
      {
        role: 'system',
        content: `You are a translation assistant. Translate the given text ${sourcePart}to ${targetLanguage}.
Preserve the original tone and meaning exactly — do not paraphrase or add context.

Return a JSON object with:
- "translated_text": string
- "source_language": string (ISO 639-1 language code, e.g. "vi", "en")

Respond ONLY with the JSON object.`,
      },
      {
        role: 'user',
        content: text,
      },
    ];
  }

  buildEntityDetectionPrompt(body: string): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `${APP_CONTEXT}
Your task: detect named entities in the chat message that are worth explaining to users.
${LANGUAGE_RULE}

Entity types: tool | company | person | concept | location | product | other

Rules:
- Only include entities with confidence >= 0.75
- Do NOT include common words, pronouns, or generic nouns
- Return ONLY the entity text and type — do not guess character positions

Return a JSON object with:
- "entities": array of objects, each with:
  - "text": string (exact text as it appears in the message)
  - "type": one of the entity types above
  - "confidence": number between 0.75 and 1

Respond ONLY with the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: body,
      },
    ];
  }

  buildEntityInfoPrompt(
    text: string,
    type: string,
    language: string,
  ): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `You are a knowledgeable assistant providing concise info panel content for a chat application.
Generate factual information about the given entity in ${language === 'vi' ? 'Vietnamese' : 'English'}.

Rules:
- Write only facts you are confident about. If uncertain about specific dates, numbers, or statistics, omit them rather than guess.
- Do not fabricate information. If you have limited knowledge about this entity, say so briefly.
- Keep the summary to 2-3 sentences. Keep details to 150-200 words.

Return a JSON object with:
- "title": string (display name, may differ from raw input)
- "summary": string (2-3 sentence overview)
- "details": string (150-200 words, factual content)
- "related_entities": array of strings (3-5 related names, empty array if none)

Respond ONLY with the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: `Entity: "${text}" (type: ${type})`,
      },
    ];
  }

  buildDocumentQueryPrompt(
    query: string,
    relevantChunks: Array<{ content: string; chunkIndex: number }>,
  ): LlmChatMessage[] {
    const contextBlock = relevantChunks
      .map((c, i) => `[Nguồn ${i + 1}] ${c.content}`)
      .join('\n\n');

    return [
      {
        role: 'system',
        content: `${APP_CONTEXT}
Your task: answer the user's question based ONLY on the provided document excerpts.
${LANGUAGE_RULE}

Rules:
- If the answer cannot be found in the provided context, say so clearly
- Cite which source numbers you used in your answer
- Do not add information from outside the provided excerpts

Return a JSON object with:
- "answer": string
- "source_indices": array of numbers (1-based, which sources you used)

Respond ONLY with the JSON object.`,
      },
      {
        role: 'user',
        content: `Nội dung tài liệu:\n${contextBlock}\n\nCâu hỏi: ${query}`,
      },
    ];
  }
}
