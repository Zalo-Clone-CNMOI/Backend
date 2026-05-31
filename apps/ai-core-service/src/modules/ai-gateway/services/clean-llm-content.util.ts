const FALLBACK_VI = 'Xin lỗi, không thể trả lời lúc này. Vui lòng thử lại.';

/**
 * Strip Anthropic/Claude tool-call artifact blocks that can leak into the
 * LLM `content` field even when no tools were declared in the request.
 * Returns a VI-language fallback when the entire content is an artifact.
 * Safe to call on any string — returns it unchanged when no artifact detected.
 *
 * Four formats handled:
 *   B  <tool_call>…</tool_call>                        (JSON-in-XML hybrid)
 *   C  <antml_function_calls>…</antml_function_calls>  (modern Anthropic XML)
 *   D  [{"type":"tool_use",…}]                         (Anthropic JSON array)
 *   A  <function_calls>…</function_results>            (legacy Anthropic XML)
 */
export function cleanLlmContent(content: string): string {
  if (!content) return content;

  // ── Format B: <tool_call> / <tool_calls> JSON-in-XML ─────────────────────
  if (content.includes('<tool_call>') || content.includes('<tool_calls>')) {
    const cleaned = content
      .replace(/\n?<tool_call>[\s\S]*?<\/tool_call>\n?/g, '\n')
      .replace(/\n?<tool_calls>[\s\S]*?<\/tool_calls>\n?/g, '\n')
      .replace(/<\/?tool_calls?[^>]*>/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return cleaned || FALLBACK_VI;
  }

  // ── Format C: <antml_function_calls> modern Anthropic XML ─────────────────
  if (content.includes('<antml_function_calls>')) {
    const lastResultsEnd = content.lastIndexOf('</antml_function_results>');
    if (lastResultsEnd !== -1) {
      const afterResults = content
        .slice(lastResultsEnd + '</antml_function_results>'.length)
        .trim();
      if (afterResults)
        return afterResults
          .replace(
            /<\/?antml_(?:function_calls|function_results|invoke|parameter)[^>]*>/g,
            '',
          )
          .trim();
    }
    const firstCallStart = content.indexOf('<antml_function_calls>');
    if (firstCallStart > 0) {
      const preamble = content.slice(0, firstCallStart).trim();
      if (preamble) return preamble;
    }
    return FALLBACK_VI;
  }

  // ── Format D: Anthropic content-block JSON array {"type":"tool_use",…} ────
  if (/"type"\s*:\s*"tool_use"/.test(content)) {
    const cleaned = content
      .replace(/\n?\[[\s\S]*?"type"\s*:\s*"tool_use"[\s\S]*?\]\n?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return cleaned || FALLBACK_VI;
  }

  // ── Format A: <function_calls>/<function_results> legacy Anthropic XML ────
  if (!content.includes('<function_calls>')) return content;

  const lastResultsEnd = content.lastIndexOf('</function_results>');
  if (lastResultsEnd !== -1) {
    const afterResults = content
      .slice(lastResultsEnd + '</function_results>'.length)
      .trim();
    if (afterResults)
      return afterResults
        .replace(/<\/?function_(calls|results)[^>]*>/g, '')
        .trim();
  }
  const firstCallStart = content.indexOf('<function_calls>');
  if (firstCallStart > 0) {
    const preamble = content.slice(0, firstCallStart).trim();
    if (preamble) return preamble;
  }
  return FALLBACK_VI;
}

/**
 * Stream-safe variant for individual chunks. Only strips COMPLETE artifact
 * blocks (both opening and closing tag present in the chunk). Partial/split
 * tags are passed through unchanged — they span chunk boundaries and cannot
 * be safely removed without buffering state.
 */
export function cleanStreamChunk(chunk: string): string {
  if (!chunk) return chunk;

  // Format C: only strip if both opening AND closing tag are in this chunk
  if (
    chunk.includes('<antml_function_calls>') &&
    chunk.includes('</antml_function_calls>')
  ) {
    const firstStart = chunk.indexOf('<antml_function_calls>');
    return firstStart > 0 ? chunk.slice(0, firstStart).trim() : '';
  }

  // Format B: only strip if both <tool_call> and </tool_call> are present
  if (chunk.includes('<tool_call>') && chunk.includes('</tool_call>')) {
    return chunk
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, '')
      .trim();
  }

  // Format D: only strip if both the tool_use marker and a closing ] are present
  if (/"type"\s*:\s*"tool_use"/.test(chunk) && /\]/.test(chunk)) {
    return chunk
      .replace(/\[[\s\S]*?"type"\s*:\s*"tool_use"[\s\S]*?\]/g, '')
      .trim();
  }

  // Format A: only strip if both <function_calls> and </function_calls> present
  if (
    chunk.includes('<function_calls>') &&
    chunk.includes('</function_calls>')
  ) {
    const firstStart = chunk.indexOf('<function_calls>');
    return firstStart > 0 ? chunk.slice(0, firstStart).trim() : '';
  }

  return chunk;
}
