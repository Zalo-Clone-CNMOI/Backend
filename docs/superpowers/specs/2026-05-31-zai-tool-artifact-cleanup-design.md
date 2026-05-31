# Zai Tool Artifact Cleanup — Design Spec

**Date:** 2026-05-31  
**Status:** Approved  
**Scope:** `apps/ai-core-service` — `ai-gateway` module

---

## Problem

Anthropic/Claude models (and occasionally other providers) sometimes emit tool-call XML blocks inline inside the `content` string — even when no tools are declared in the request. Four known formats leak:

| Format | Example trigger |
|--------|----------------|
| A — Anthropic legacy XML | `<function_calls><invoke>…</invoke></function_calls>` |
| B — JSON-in-XML hybrid | `<tool_call>{…}</tool_call>` |
| C — Anthropic modern XML (most common) | `<antml_function_calls>…</antml_function_calls>` |
| D — Anthropic Messages API JSON array | `[{"type":"tool_use","id":"toolu_…",…}]` |

These fragments appear raw in the Zai chat bubble, catch-up summaries, and entity-info panels — visible to users as garbled output.

---

## Approach Chosen

**Universal strip in `ai-gateway.service.ts`** — clean once, protect all engines.

`AiGatewayService.complete()` is the single return point for all synchronous LLM results (zai-chat, catch-up, entity-info, smart-reply, moderation). Applying `cleanLlmContent()` here means every consumer gets clean text without per-engine changes.

`completeStream()` receives chunks — each chunk must also be cleaned so streaming Zai replies don't flash artifact fragments mid-stream.

---

## Components

### 1. `clean-llm-content.util.ts` (new file)

**Location:** `apps/ai-core-service/src/modules/ai-gateway/services/clean-llm-content.util.ts`

Exports one function:

```
cleanLlmContent(content: string): string
```

**Logic (per format, in priority order):**

- **Format C** (`<antml_function_calls>`): Most common. If `</antml_function_results>` is found, return the text after the last closing tag. If there's text before the first opening tag, return that. Otherwise return VI fallback.
- **Format A** (`<function_calls>`): Same structure as C, same extraction logic.
- **Format B** (`<tool_call>` / `<tool_calls>`): Strip all tags + content between them, collapse excess newlines.
- **Format D** (JSON `[{"type":"tool_use"…}]` array): Detect via regex, strip the array, return surrounding text if any.
- **No match**: Return `content` unchanged.

**Fallback string** (when only artifacts, no prose): `'Xin lỗi, không thể trả lời lúc này. Vui lòng thử lại.'`

**Exports a second function:**
```
cleanStreamChunk(chunk: string): string
```
Same logic but tolerates partial/incomplete tags (a chunk may contain only the opening half of an artifact block). Strategy: strip only *complete* artifact blocks; pass through incomplete ones. This prevents mid-stream flicker while still cleaning fully-delivered artifacts.

### 2. `clean-llm-content.util.spec.ts` (new file)

Unit tests:
- Format A–D: each gets an input with artifact, expects clean output
- Format C with preamble prose: expects preamble preserved
- Format C all-artifact: expects VI fallback
- Content with no artifacts: expects content returned unchanged
- Empty string: returns empty string
- Stream chunk with complete artifact: stripped
- Stream chunk with partial open tag only: passed through unchanged

### 3. `ai-gateway.service.ts` — wired at two points

**`complete()` method** (after `provider.complete(options)` returns, before `return result`):
```ts
result = { ...result, content: cleanLlmContent(result.content) };
```

**`completeStream()` method** (in the `onChunk` callback path, before forwarding to the caller):
```ts
const cleaned = cleanStreamChunk(chunk.content);
if (cleaned) onChunk({ ...chunk, content: cleaned });
```

No changes to provider files, engine files, or any other layer.

---

## Data Flow (After Fix)

```
LLM Provider
  └─ raw content (may contain <antml_function_calls>…)
       │
       ▼
AiGatewayService.complete()
  └─ cleanLlmContent(result.content)   ← NEW
       │
       ▼
Engine (zai-chat / catch-up / entity-info / …)
  └─ clean plain text ✓
```

---

## Error Handling

- `cleanLlmContent` is pure (no throws). If a regex edge case produces an empty string after cleaning, the VI fallback is used.
- Cleaning is applied after successful provider completion only — timeout/rejection paths are unaffected.
- Logging: `ai-gateway.service.ts` emits a `logger.debug` line when artifact stripping fires (includes format detected, char count before/after). Useful for identifying which provider/model triggers leakage.

---

## Testing

| Test | What's verified |
|------|----------------|
| Unit: 4 format strips | Artifact fully removed, prose preserved |
| Unit: all-artifact input | VI fallback returned |
| Unit: clean input | Content unchanged (no false positives) |
| Unit: stream chunk partial tag | Incomplete tag passed through |
| Integration: existing engine specs | No regressions on `entity-detection`, `catch-up`, `zai-chat` specs |
| `tsc` | 0 errors |

---

## Out of Scope

- Adding actual tool-calling support to Zai (separate phase)
- Cleaning artifacts from ScyllaDB-persisted messages already stored with artifacts (historical fix — separate migration if needed)
- Changing any provider-level implementation

---

## Files Changed

| File | Action |
|------|--------|
| `apps/ai-core-service/src/modules/ai-gateway/services/clean-llm-content.util.ts` | Create |
| `apps/ai-core-service/src/modules/ai-gateway/services/clean-llm-content.util.spec.ts` | Create |
| `apps/ai-core-service/src/modules/ai-gateway/services/ai-gateway.service.ts` | Edit (2 lines) |
