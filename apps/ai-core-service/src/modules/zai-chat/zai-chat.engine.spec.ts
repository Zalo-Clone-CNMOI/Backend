import { Test, TestingModule } from '@nestjs/testing';
import { ZAI_EMPTY_RESPONSE_FALLBACK, ZaiChatEngine } from './zai-chat.engine';
import { DocumentRagService } from './document-rag.service';
import { ZaiMemoryService } from './zai-memory.service';
import { MessageRepository } from '@libs/scylla';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import { BusinessException } from '@app/types';
import { ErrorCode } from '@app/constant';
import type { AiZaiChatRequestEvent } from '@libs/contracts';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';
import type { LlmChatMessage } from '../ai-gateway/interfaces';

// ── Helpers ─────────────────────────────────────────────────────────────────

const ZAI_BOT_ID = 'zai-bot-uuid';
const CONV_ID = 'conv-001';
const USER_ID = 'user-001';
const DOC_ID = 'doc-001';

function makeEvent(
  overrides: Partial<AiZaiChatRequestEvent> = {},
): AiZaiChatRequestEvent {
  return {
    message_id: 'msg-new',
    conversation_id: CONV_ID,
    sender_id: USER_ID,
    body: 'Hello Zai!',
    created_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeMsg(
  id: string,
  senderId: string,
  body: string,
  overrides: Partial<PersistedMessage> = {},
): PersistedMessage {
  return {
    message_id: id,
    conversation_id: CONV_ID,
    sender_id: senderId,
    body,
    created_at: Date.now(),
    ...overrides,
  } as PersistedMessage;
}

function makeGatewayResult(content = 'Sure, I can help!') {
  return {
    content,
    tokensIn: 50,
    tokensOut: 20,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 300,
  };
}

function makeMessageRepo(
  items: PersistedMessage[] = [],
): jest.Mocked<MessageRepository> {
  return {
    getMessages: jest
      .fn()
      .mockResolvedValue({ items, has_more: false, next_cursor: null }),
  } as unknown as jest.Mocked<MessageRepository>;
}

function makeGateway(
  result = makeGatewayResult(),
): jest.Mocked<AiGatewayService> {
  return {
    complete: jest.fn().mockResolvedValue(result),
    completeStream: jest.fn().mockResolvedValue(result),
  } as unknown as jest.Mocked<AiGatewayService>;
}

function makePromptBuilder(): jest.Mocked<PromptBuilderService> {
  return {
    buildZaiChatPrompt: jest.fn((history: LlmChatMessage[]) => [
      { role: 'system' as const, content: 'You are Zai' },
      ...history,
    ]),
    buildZaiMentionReplyPrompt: jest.fn(
      (history: LlmChatMessage[], trigger: string) => [
        { role: 'system' as const, content: 'You are Zai (mention)' },
        ...history,
        { role: 'user' as const, content: trigger },
      ],
    ),
  } as unknown as jest.Mocked<PromptBuilderService>;
}

function makeAiMetrics(): jest.Mocked<AiMetricsService> {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeDocumentRag(): jest.Mocked<DocumentRagService> {
  return {
    validateDocumentAccess: jest.fn().mockResolvedValue({}),
    buildRagMessages: jest.fn().mockResolvedValue([
      { role: 'system', content: 'You are doc Zai' },
      { role: 'user', content: 'doc question' },
    ]),
  } as unknown as jest.Mocked<DocumentRagService>;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('ZaiChatEngine', () => {
  let engine: ZaiChatEngine;
  let messageRepo: jest.Mocked<MessageRepository>;
  let gateway: jest.Mocked<AiGatewayService>;
  let promptBuilder: jest.Mocked<PromptBuilderService>;
  let aiMetrics: jest.Mocked<AiMetricsService>;
  let documentRag: jest.Mocked<DocumentRagService>;
  let zaiMemory: jest.Mocked<ZaiMemoryService>;

  async function build(
    repoOverride?: jest.Mocked<MessageRepository>,
    gatewayOverride?: jest.Mocked<AiGatewayService>,
    ragOverride?: jest.Mocked<DocumentRagService>,
  ) {
    messageRepo = repoOverride ?? makeMessageRepo();
    gateway = gatewayOverride ?? makeGateway();
    promptBuilder = makePromptBuilder();
    aiMetrics = makeAiMetrics();
    documentRag = ragOverride ?? makeDocumentRag();
    // L2 disabled by default: pass the L1 history straight through.
    zaiMemory = {
      withRollingSummary: jest.fn((_c, _u, history: LlmChatMessage[]) =>
        Promise.resolve(history),
      ),
    } as unknown as jest.Mocked<ZaiMemoryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZaiChatEngine,
        { provide: MessageRepository, useValue: messageRepo },
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useValue: promptBuilder },
        { provide: AiMetricsService, useValue: aiMetrics },
        { provide: DocumentRagService, useValue: documentRag },
        { provide: ZaiMemoryService, useValue: zaiMemory },
        { provide: APP_CONFIG, useValue: { zaiBotUserId: ZAI_BOT_ID } },
      ],
    }).compile();

    engine = module.get<ZaiChatEngine>(ZaiChatEngine);
  }

  beforeEach(() => build());
  afterEach(() => jest.clearAllMocks());

  // ── Loop guard ─────────────────────────────────────────────────────────────

  it('returns null and skips gateway when sender_id is zaiBotUserId (loop guard)', async () => {
    const event = makeEvent({ sender_id: ZAI_BOT_ID });
    const result = await engine.respond(event);

    expect(result).toBeNull();
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('happy path: fetches history, calls gateway, returns AiChatSendInput', async () => {
    const items = [
      makeMsg('msg-2', ZAI_BOT_ID, 'How can I help?'),
      makeMsg('msg-1', USER_ID, 'Hi there'),
    ];
    const repo = makeMessageRepo(items);
    await build(repo);

    const event = makeEvent();
    const result = await engine.respond(event);

    expect(repo.getMessages).toHaveBeenCalledWith(CONV_ID, { limit: 20 });
    expect(promptBuilder.buildZaiChatPrompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Hi there' }),
        expect.objectContaining({
          role: 'assistant',
          content: 'How can I help?',
        }),
      ]),
    );
    expect(gateway.complete).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ maxTokens: 1024, temperature: 0.7 }),
    );
    expect(result).not.toBeNull();
    expect(result!.reply.conversation_id).toBe(CONV_ID);
    expect(result!.reply.body).toBe('Sure, I can help!');
    expect(result!.reply.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // S1: engine now surfaces provider + tokens for AiStreamComplete.
    expect(result!.provider).toBe('openai');
    expect(result!.tokensIn).toBe(50);
    expect(result!.tokensOut).toBe(20);
  });

  // ── Cold start ─────────────────────────────────────────────────────────────

  it('cold start: empty history → gateway still called with system-only messages → reply published', async () => {
    const repo = makeMessageRepo([]);
    await build(repo);

    const result = await engine.respond(makeEvent());

    expect(gateway.complete).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ maxTokens: 1024, temperature: 0.7 }),
    );
    const completeCalls = (gateway.complete as jest.Mock).mock.calls as [
      string,
      { messages: LlmChatMessage[] },
    ][];
    const msgs = completeCalls[0][1].messages;
    expect(msgs.some((m) => m.role === 'system')).toBe(true);
    expect(result).not.toBeNull();
  });

  // ── Deleted message filter ─────────────────────────────────────────────────

  it('filters out deleted messages from history before building prompt', async () => {
    const items = [
      makeMsg('msg-3', USER_ID, 'still here'),
      makeMsg('msg-2', USER_ID, 'deleted msg', { deleted_at: Date.now() }),
      makeMsg('msg-1', USER_ID, 'first msg'),
    ];
    const repo = makeMessageRepo(items);
    await build(repo);

    await engine.respond(makeEvent());

    const calls = (promptBuilder.buildZaiChatPrompt as jest.Mock).mock
      .calls as [LlmChatMessage[]][];
    const historyArg = calls[0][0];
    expect(historyArg.every((m) => m.content !== 'deleted msg')).toBe(true);
    expect(historyArg.length).toBe(2);
  });

  // ── Role mapping ───────────────────────────────────────────────────────────

  it('maps zaiBotUserId sender → role:assistant, others → role:user', async () => {
    const items = [
      makeMsg('msg-2', ZAI_BOT_ID, 'Zai reply'),
      makeMsg('msg-1', USER_ID, 'user msg'),
    ];
    const repo = makeMessageRepo(items);
    await build(repo);

    await engine.respond(makeEvent());

    const calls2 = (promptBuilder.buildZaiChatPrompt as jest.Mock).mock
      .calls as [LlmChatMessage[]][];
    const history = calls2[0][0];
    // Items are reversed to chronological order
    expect(history[0]).toMatchObject({ role: 'user', content: 'user msg' });
    expect(history[1]).toMatchObject({
      role: 'assistant',
      content: 'Zai reply',
    });
  });

  // ── ScyllaDB fetch failure ─────────────────────────────────────────────────

  it('proceeds with empty history when ScyllaDB fetch throws — gateway still called', async () => {
    const repo = makeMessageRepo();
    (repo.getMessages as jest.Mock).mockRejectedValue(
      new Error('ScyllaDB down'),
    );
    await build(repo);

    const result = await engine.respond(makeEvent());

    expect(gateway.complete).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  // ── Gateway failure ────────────────────────────────────────────────────────

  it('returns null when gateway throws — no rethrow', async () => {
    const gw = makeGateway();
    (gw.complete as jest.Mock).mockRejectedValue(new Error('LLM error'));
    await build(undefined, gw);

    const result = await engine.respond(makeEvent());

    expect(result).toBeNull();
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'zai_chat',
      'unknown',
      'unknown',
      0,
      0,
      expect.any(Number),
      false,
    );
  });

  // ── Empty LLM response fallback (C3) ───────────────────────────────────────

  it('empty LLM content → returns fallback body, NOT null', async () => {
    const gw = makeGateway(makeGatewayResult(''));
    await build(undefined, gw);

    const result = await engine.respond(makeEvent());

    expect(result).not.toBeNull();
    expect(result!.reply.body).toBe(ZAI_EMPTY_RESPONSE_FALLBACK);
    // Metrics still recorded as success — the LLM responded, the content
    // just happened to be empty (refusal, etc.).
    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'zai_chat',
      'openai',
      'gpt-4o',
      50,
      20,
      300,
      true,
    );
  });

  it('whitespace-only LLM content → also returns fallback body', async () => {
    const gw = makeGateway(makeGatewayResult('   \n\t  '));
    await build(undefined, gw);

    const result = await engine.respond(makeEvent());

    expect(result).not.toBeNull();
    expect(result!.reply.body).toBe(ZAI_EMPTY_RESPONSE_FALLBACK);
  });

  // ── Metrics ────────────────────────────────────────────────────────────────

  it('records success metrics on happy path', async () => {
    await engine.respond(makeEvent());

    expect(aiMetrics.recordRequest).toHaveBeenCalledWith(
      'zai_chat',
      'openai',
      'gpt-4o',
      50,
      20,
      300,
      true,
    );
  });

  // ── Phase 4: Document RAG ──────────────────────────────────────────────────

  it('feature=document: delegates to DocumentRagService.buildRagMessages with conversation history, skips buildZaiChatPrompt', async () => {
    // Seed history so we can assert it flows into the RAG call
    const items = [
      makeMsg('msg-2', ZAI_BOT_ID, 'Prior Zai answer'),
      makeMsg('msg-1', USER_ID, 'Prior user question'),
    ];
    const repo = makeMessageRepo(items);
    await build(repo);

    const event = makeEvent({
      body: 'Summarize this',
      ai_context: { feature: 'document', document_id: DOC_ID, created_at: 1 },
    });

    const result = await engine.respond(event);

    expect(documentRag.validateDocumentAccess).toHaveBeenCalledWith(
      USER_ID,
      DOC_ID,
    );
    expect(documentRag.buildRagMessages).toHaveBeenCalledWith(
      USER_ID,
      DOC_ID,
      'Summarize this',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'Prior user question',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Prior Zai answer',
        }),
      ]),
    );
    expect(promptBuilder.buildZaiChatPrompt).not.toHaveBeenCalled();
    expect(gateway.complete).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('feature=document: returns graceful reply when document is no longer available', async () => {
    const rag = makeDocumentRag();
    (rag.validateDocumentAccess as jest.Mock).mockRejectedValue(
      new BusinessException(ErrorCode.NOT_FOUND, 'Document not found'),
    );
    await build(undefined, undefined, rag);

    const event = makeEvent({
      ai_context: { feature: 'document', document_id: DOC_ID, created_at: 1 },
    });
    const result = await engine.respond(event);

    expect(result).not.toBeNull();
    expect(result!.reply.body).toContain('no longer available');
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  // ── Phase 4: Mention routing ───────────────────────────────────────────────

  it('trigger=mention: calls buildZaiMentionReplyPrompt with smaller history limit', async () => {
    const event = makeEvent({ trigger: 'mention', body: 'hey @zai help' });
    await engine.respond(event);

    expect(messageRepo.getMessages).toHaveBeenCalledWith(CONV_ID, {
      limit: 10,
    });
    expect(promptBuilder.buildZaiMentionReplyPrompt).toHaveBeenCalledWith(
      expect.any(Array),
      'hey @zai help',
    );
    expect(promptBuilder.buildZaiChatPrompt).not.toHaveBeenCalled();
  });

  // ── Phase 4: Streaming ─────────────────────────────────────────────────────

  it('onChunk provided: calls gateway.completeStream, not gateway.complete', async () => {
    const onChunk = jest.fn().mockResolvedValue(undefined);
    await engine.respond(makeEvent(), onChunk);

    expect(gateway.completeStream).toHaveBeenCalled();
    expect(gateway.complete).not.toHaveBeenCalled();
  });

  it('onChunk undefined: calls gateway.complete (non-streaming fallback)', async () => {
    await engine.respond(makeEvent());

    expect(gateway.complete).toHaveBeenCalled();
    expect(gateway.completeStream).not.toHaveBeenCalled();
  });

  it('streaming: forwards chunk content to onChunk callback', async () => {
    const gw = makeGateway();
    type StreamCb = (chunk: {
      content: string;
      index: number;
      isFinal: boolean;
    }) => void;
    (gw.completeStream as jest.Mock).mockImplementation(
      (_userId: string, _opts: unknown, cb: StreamCb) => {
        cb({ content: 'hello', index: 0, isFinal: false });
        cb({ content: ' world', index: 1, isFinal: false });
        return Promise.resolve(makeGatewayResult('hello world'));
      },
    );
    await build(undefined, gw);

    const onChunk = jest.fn().mockResolvedValue(undefined);
    await engine.respond(makeEvent(), onChunk);

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' world');
  });

  // ── Phase 6 C12: abort discards the partial reply ──────────────────────────

  it('aborted signal: returns null, records no metrics (partial discarded)', async () => {
    const controller = new AbortController();
    controller.abort();
    const onChunk = jest.fn().mockResolvedValue(undefined);

    const result = await engine.respond(
      makeEvent(),
      onChunk,
      controller.signal,
    );

    expect(result).toBeNull();
    expect(gateway.completeStream).toHaveBeenCalled();
    // No success metric and no reply built when the stream was aborted.
    expect(aiMetrics.recordRequest).not.toHaveBeenCalled();
  });

  it('passes the abort signal through to gateway.completeStream', async () => {
    const controller = new AbortController();
    const onChunk = jest.fn().mockResolvedValue(undefined);

    await engine.respond(makeEvent(), onChunk, controller.signal);

    const args = (gateway.completeStream as jest.Mock).mock.calls[0];
    // signal is the 4th positional arg (userId, options, onChunk, signal).
    expect(args[3]).toBe(controller.signal);
  });

  // ── Phase 6 C6: strategy registry fallback ─────────────────────────────────

  it('unknown feature (no document_id, no mention) falls back to the general strategy', async () => {
    const event = makeEvent({
      ai_context: { feature: 'translation', created_at: 1 } as never,
    });

    const result = await engine.respond(event);

    expect(promptBuilder.buildZaiChatPrompt).toHaveBeenCalled();
    expect(promptBuilder.buildZaiMentionReplyPrompt).not.toHaveBeenCalled();
    expect(documentRag.buildRagMessages).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  // ── Phase 6 C7: markdown body_format for document replies ───────────────────

  it('document reply carries body_format:"markdown"', async () => {
    const event = makeEvent({
      body: 'Summarize this',
      ai_context: { feature: 'document', document_id: DOC_ID, created_at: 1 },
    });

    const result = await engine.respond(event);

    expect(result).not.toBeNull();
    expect(result!.reply.body_format).toBe('markdown');
  });

  it('general reply omits body_format (text default)', async () => {
    const result = await engine.respond(makeEvent());

    expect(result).not.toBeNull();
    expect(result!.reply.body_format).toBeUndefined();
  });

  it('mention reply omits body_format (text default)', async () => {
    const result = await engine.respond(
      makeEvent({ trigger: 'mention', body: 'hey @zai' }),
    );

    expect(result).not.toBeNull();
    expect(result!.reply.body_format).toBeUndefined();
  });

  it('document-unavailable short-circuit reply stays plain text (no markdown)', async () => {
    const rag = makeDocumentRag();
    (rag.validateDocumentAccess as jest.Mock).mockRejectedValue(
      new BusinessException(ErrorCode.NOT_FOUND, 'Document not found'),
    );
    await build(undefined, undefined, rag);

    const event = makeEvent({
      ai_context: { feature: 'document', document_id: DOC_ID, created_at: 1 },
    });
    const result = await engine.respond(event);

    expect(result!.reply.body_format).toBeUndefined();
  });

  // ── Phase 6 C8: L2 rolling-summary memory hook ──────────────────────────────

  it('passes the L1 history through ZaiMemoryService and feeds the result to the prompt', async () => {
    const items = [makeMsg('msg-1', USER_ID, 'recent question')];
    const repo = makeMessageRepo(items);
    await build(repo);

    // Simulate L2 enabled: prepend a rolling-summary system message.
    const summaryMsg: LlmChatMessage = {
      role: 'system',
      content: 'Summary of earlier conversation: prior topics.',
    };
    zaiMemory.withRollingSummary.mockImplementation((_c, _u, history) =>
      Promise.resolve([summaryMsg, ...history]),
    );

    await engine.respond(makeEvent());

    expect(zaiMemory.withRollingSummary).toHaveBeenCalledWith(
      CONV_ID,
      USER_ID,
      expect.any(Array),
      'trace-001',
    );
    const calls = (promptBuilder.buildZaiChatPrompt as jest.Mock).mock
      .calls as [LlmChatMessage[]][];
    expect(calls[0][0]).toContainEqual(summaryMsg);
  });
});
