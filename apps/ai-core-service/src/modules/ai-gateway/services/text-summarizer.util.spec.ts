import {
  filterMessagesForSummarization,
  parseAiSummaryJson,
  recordSummarizationMetrics,
} from './text-summarizer.util';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';
import type { AiMetricsService } from './ai-metrics.service';
import type { LlmCompletionResult } from '../interfaces';

function msg(overrides: Partial<PersistedMessage> = {}): PersistedMessage {
  return {
    message_id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    body: 'hello',
    created_at: 1000,
    ...overrides,
  } as PersistedMessage;
}

describe('filterMessagesForSummarization', () => {
  it('drops soft-deleted messages', () => {
    const out = filterMessagesForSummarization([
      msg({ message_id: 'a' }),
      msg({ message_id: 'b', deleted_at: Date.now() }),
    ]);
    expect(out.map((m) => m.message_id)).toEqual(['a']);
  });

  it('drops messages at/older than `since` (exclusive boundary)', () => {
    const out = filterMessagesForSummarization(
      [
        msg({ message_id: 'old', created_at: 500 }),
        msg({ message_id: 'eq', created_at: 1000 }),
        msg({ message_id: 'new', created_at: 1500 }),
      ],
      { since: 1000 },
    );
    // since is exclusive: created_at <= since is dropped.
    expect(out.map((m) => m.message_id)).toEqual(['new']);
  });

  it('drops body-less messages only when requireBody is set', () => {
    const input = [
      msg({ message_id: 'withBody', body: 'hi' }),
      msg({ message_id: 'noBody', body: '' }),
    ];
    expect(
      filterMessagesForSummarization(input).map((m) => m.message_id),
    ).toEqual(['withBody', 'noBody']);
    expect(
      filterMessagesForSummarization(input, { requireBody: true }).map(
        (m) => m.message_id,
      ),
    ).toEqual(['withBody']);
  });

  it('preserves input order', () => {
    const out = filterMessagesForSummarization([
      msg({ message_id: 'z', created_at: 3000 }),
      msg({ message_id: 'y', created_at: 2000 }),
      msg({ message_id: 'x', created_at: 1000 }),
    ]);
    expect(out.map((m) => m.message_id)).toEqual(['z', 'y', 'x']);
  });

  it('returns empty array for empty input', () => {
    expect(filterMessagesForSummarization([])).toEqual([]);
  });
});

describe('parseAiSummaryJson', () => {
  it('extracts summary from valid JSON', () => {
    expect(parseAiSummaryJson('{"summary":"the gist"}')).toEqual({
      summary: 'the gist',
    });
  });

  it('falls back to raw content when JSON lacks a string summary', () => {
    expect(parseAiSummaryJson('{"summary":123}')).toEqual({
      summary: '{"summary":123}',
    });
  });

  it('falls back to raw content on non-JSON input', () => {
    expect(parseAiSummaryJson('just plain text')).toEqual({
      summary: 'just plain text',
    });
  });
});

describe('recordSummarizationMetrics', () => {
  let aiMetrics: jest.Mocked<AiMetricsService>;

  beforeEach(() => {
    aiMetrics = {
      recordRequest: jest.fn(),
    } as unknown as jest.Mocked<AiMetricsService>;
  });

  it('records a success with provider/model/tokens from the result', () => {
    const result: LlmCompletionResult = {
      content: 'x',
      tokensIn: 30,
      tokensOut: 12,
      model: 'gpt-4o',
      provider: 'openai',
      latencyMs: 250,
    };
    recordSummarizationMetrics(aiMetrics, 'summary', result);
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'summary',
      'openai',
      'gpt-4o',
      30,
      12,
      250,
      true,
    );
  });

  it('records a failure with unknown provider/model and zero tokens on null', () => {
    recordSummarizationMetrics(aiMetrics, 'catch_up', null);
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'catch_up',
      'unknown',
      'unknown',
      0,
      0,
      0,
      false,
    );
  });
});
