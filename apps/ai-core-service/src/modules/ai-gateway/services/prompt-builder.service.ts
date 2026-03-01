import { Injectable, Logger } from '@nestjs/common';
import { LlmChatMessage } from '../interfaces';

/**
 * PromptBuilderService — constructs well-structured prompts
 * for each AI feature using template patterns.
 *
 * All prompts are English-only for MVP.
 */
@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  /**
   * Build moderation prompt.
   */
  buildModerationPrompt(messageBody: string): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `You are a content moderation assistant. Analyze the following message and classify it.
Return a JSON object with:
- "is_flagged": boolean (true if harmful)
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

  /**
   * Build smart reply prompt with conversation context.
   */
  buildSmartReplyPrompt(
    lastMessage: string,
    conversationContext: string[],
  ): LlmChatMessage[] {
    const contextBlock = conversationContext.length
      ? `Recent conversation:\n${conversationContext.join('\n')}\n\n`
      : '';

    return [
      {
        role: 'system',
        content: `You are a smart reply assistant for a chat application.
Given the conversation context and the last message, suggest 3 short, natural reply options.
Return a JSON object with:
- "suggestions": array of 3 strings (each under 50 characters)

Respond ONLY with the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: `${contextBlock}Last message: "${lastMessage}"`,
      },
    ];
  }

  /**
   * Build chat summary prompt.
   */
  buildSummaryPrompt(messages: string[]): LlmChatMessage[] {
    return [
      {
        role: 'system',
        content: `You are a conversation summarizer. Summarize the following chat messages concisely.
Focus on key topics, decisions, and action items.
Keep the summary under 200 words.
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

  /**
   * Build translation prompt.
   */
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
Preserve the original tone and meaning.
Return a JSON object with:
- "translated_text": string
- "source_language": string (detected or given source language code)

Respond ONLY with the JSON object.`,
      },
      {
        role: 'user',
        content: text,
      },
    ];
  }

  /**
   * Build document Q&A prompt with RAG context.
   */
  buildDocumentQueryPrompt(
    query: string,
    relevantChunks: Array<{ content: string; chunkIndex: number }>,
  ): LlmChatMessage[] {
    const contextBlock = relevantChunks
      .map((c, i) => `[Source ${i + 1}] ${c.content}`)
      .join('\n\n');

    return [
      {
        role: 'system',
        content: `You are a document analysis assistant. Answer the user's question based ONLY on the provided document excerpts.
If the answer cannot be found in the provided context, say so explicitly.
Cite source numbers in your answer.

Return a JSON object with:
- "answer": string
- "source_indices": array of numbers (which sources you used)

Respond ONLY with the JSON object.`,
      },
      {
        role: 'user',
        content: `Context:\n${contextBlock}\n\nQuestion: ${query}`,
      },
    ];
  }
}
