import { cleanLlmContent, cleanStreamChunk } from './clean-llm-content.util';

const FALLBACK = 'Xin lỗi, không thể trả lời lúc này. Vui lòng thử lại.';

describe('cleanLlmContent', () => {
  it('returns clean content unchanged (no false positives)', () => {
    expect(cleanLlmContent('Tesla was a brilliant inventor.')).toBe(
      'Tesla was a brilliant inventor.',
    );
  });

  it('returns empty string unchanged', () => {
    expect(cleanLlmContent('')).toBe('');
  });

  // ── Format B ──────────────────────────────────────────────────────────────

  it('[Format B] strips <tool_call> block, preserving surrounding prose', () => {
    const input =
      'Here is my answer.\n<tool_call>{"name":"search","args":{}}</tool_call>\nDone.';
    expect(cleanLlmContent(input)).toBe('Here is my answer.\nDone.');
  });

  it('[Format B] returns VI fallback when content is only a tool_call artifact', () => {
    expect(
      cleanLlmContent('<tool_call>{"name":"search","args":{}}</tool_call>'),
    ).toBe(FALLBACK);
  });

  // ── Format C ──────────────────────────────────────────────────────────────

  it('[Format C] preserves preamble prose before <antml_function_calls>', () => {
    const input =
      'Sure, let me check.\n<antml_function_calls>\n<antml_invoke name="search"><antml_parameter name="q">Tesla</antml_parameter></antml_invoke>\n</antml_function_calls>';
    expect(cleanLlmContent(input)).toBe('Sure, let me check.');
  });

  it('[Format C] returns text after </antml_function_results> when results are present', () => {
    const input =
      '<antml_function_calls>\n<antml_invoke name="search"><antml_parameter name="q">x</antml_parameter></antml_invoke>\n</antml_function_calls>\n<antml_function_results>\n{"result":"data"}\n</antml_function_results>\nTesla was an inventor.';
    expect(cleanLlmContent(input)).toBe('Tesla was an inventor.');
  });

  it('[Format C] returns VI fallback when content is only the antml block (no preamble, no results text)', () => {
    const input =
      '<antml_function_calls>\n<antml_invoke name="search"><antml_parameter name="q">x</antml_parameter></antml_invoke>\n</antml_function_calls>';
    expect(cleanLlmContent(input)).toBe(FALLBACK);
  });

  // ── Format D ──────────────────────────────────────────────────────────────

  it('[Format D] strips tool_use JSON array, preserving surrounding prose', () => {
    const input =
      'Processing...\n[{"type":"tool_use","id":"toolu_01","name":"search","input":{}}]\nComplete.';
    expect(cleanLlmContent(input)).toBe('Processing...\nComplete.');
  });

  it('[Format D] returns VI fallback when content is only a tool_use JSON array', () => {
    expect(
      cleanLlmContent(
        '[{"type":"tool_use","id":"toolu_01","name":"search","input":{}}]',
      ),
    ).toBe(FALLBACK);
  });

  // ── Format A ──────────────────────────────────────────────────────────────

  it('[Format A] preserves preamble prose before <function_calls>', () => {
    const input =
      'Okay.\n<function_calls>\n<invoke name="search"><query>Tesla</query></invoke>\n</function_calls>';
    expect(cleanLlmContent(input)).toBe('Okay.');
  });

  it('[Format A] returns text after </function_results> when results are present', () => {
    const input =
      '<function_calls><invoke name="search"><query>x</query></invoke></function_calls><function_results>data</function_results>Tesla was great.';
    expect(cleanLlmContent(input)).toBe('Tesla was great.');
  });

  it('[Format A] returns VI fallback when content is only function_calls artifact', () => {
    expect(
      cleanLlmContent(
        '<function_calls><invoke name="search"><query>x</query></invoke></function_calls>',
      ),
    ).toBe(FALLBACK);
  });
});

describe('cleanStreamChunk', () => {
  it('passes through clean content unchanged', () => {
    expect(cleanStreamChunk('Hello!')).toBe('Hello!');
  });

  it('passes through empty string', () => {
    expect(cleanStreamChunk('')).toBe('');
  });

  it('[Format C] strips a complete <antml_function_calls> block and returns preamble', () => {
    const chunk =
      'Okay.\n<antml_function_calls>\n<antml_invoke name="x"><antml_parameter name="q">y</antml_parameter></antml_invoke>\n</antml_function_calls>';
    const result = cleanStreamChunk(chunk);
    expect(result).not.toContain('<antml_function_calls>');
    expect(result).toBe('Okay.');
  });

  it('[Format C] passes through a partial (incomplete) opening tag unchanged', () => {
    const chunk = 'Okay.\n<antml_function_call';
    expect(cleanStreamChunk(chunk)).toBe('Okay.\n<antml_function_call');
  });

  it('[Format B] strips a complete <tool_call> block', () => {
    const chunk = 'Before.<tool_call>{"name":"x","args":{}}</tool_call>After.';
    const result = cleanStreamChunk(chunk);
    expect(result).not.toContain('<tool_call>');
    expect(result).toBe('Before.After.');
  });

  it('[Format B] passes through a chunk with only an opening <tool_call> (incomplete)', () => {
    const chunk = 'Text <tool_call>';
    expect(cleanStreamChunk(chunk)).toBe('Text <tool_call>');
  });
});
