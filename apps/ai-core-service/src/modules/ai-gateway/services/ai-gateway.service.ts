import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmEmbeddingResult,
  EmbeddingInputType,
  LLM_PROVIDERS,
} from '../interfaces';
import { DataSanitizer } from './data-sanitizer.service';
import { TokenBudgetService } from './token-budget.service';
import { AiMetricsService } from './ai-metrics.service';
import { cleanLlmContent, cleanStreamChunk } from './clean-llm-content.util';

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly circuits = new Map<string, CircuitState>();

  constructor(
    @Inject(LLM_PROVIDERS) private readonly providers: ILlmProvider[],
    private readonly sanitizer: DataSanitizer,
    private readonly tokenBudget: TokenBudgetService,
    private readonly aiMetrics: AiMetricsService,
  ) {
    for (const provider of providers) {
      this.circuits.set(provider.name, {
        failures: 0,
        lastFailure: 0,
        state: 'closed',
      });
    }
    this.logger.log(
      `AI Gateway initialized with providers: ${providers
        .map((p) => `${p.name}[${p.isAvailable ? 'READY' : 'NO KEY'}]`)
        .join(', ')}`,
    );
  }

  async complete(
    userId: string,
    options: LlmCompletionOptions,
    opts?: { skipBudgetCheck?: boolean; skipSanitize?: boolean },
  ): Promise<LlmCompletionResult> {
    if (!opts?.skipSanitize) {
      options = {
        ...options,
        messages: options.messages.map((m) => ({
          ...m,
          // TODO(Phase-3): when m.content is LlmContentPart[], text parts inside the array
          // are NOT sanitized. Add per-part sanitization before shipping any engine that
          // constructs multimodal messages from user input.
          content:
            typeof m.content === 'string'
              ? this.sanitizer.sanitize(m.content)
              : m.content,
        })),
      };
    }

    if (!opts?.skipBudgetCheck) {
      const canConsume = await this.tokenBudget.canConsume(userId, 2000);
      if (!canConsume) {
        throw new Error('Daily token budget exceeded');
      }
    }

    const errors: string[] = [];
    for (const provider of this.getAvailableProviders()) {
      if (!this.isCircuitAllowed(provider.name)) {
        this.logger.warn(`Circuit open for ${provider.name}, skipping`);
        continue;
      }

      try {
        const raw = await provider.complete(options);
        const result = { ...raw, content: cleanLlmContent(raw.content) };
        if (result.content !== raw.content) {
          this.logger.debug(
            `cleanLlmContent: stripped artifact from ${provider.name} (${raw.content.length}→${result.content.length} chars)`,
          );
        }

        this.onSuccess(provider.name);

        await this.tokenBudget.consume(
          userId,
          result.tokensIn + result.tokensOut,
        );

        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Provider ${provider.name} failed: ${msg}`);
        this.onFailure(provider.name);
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    throw new Error(`All LLM providers failed: ${errors.join('; ')}`);
  }

  async completeStream(
    userId: string,
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
    signal?: AbortSignal,
    opts?: { skipBudgetCheck?: boolean; skipSanitize?: boolean },
  ): Promise<LlmCompletionResult> {
    if (!opts?.skipSanitize) {
      options = {
        ...options,
        messages: options.messages.map((m) => ({
          ...m,
          // TODO(Phase-3): when m.content is LlmContentPart[], text parts inside the array
          // are NOT sanitized. Add per-part sanitization before shipping any engine that
          // constructs multimodal messages from user input.
          content:
            typeof m.content === 'string'
              ? this.sanitizer.sanitize(m.content)
              : m.content,
        })),
      };
    }

    if (!opts?.skipBudgetCheck) {
      const canConsume = await this.tokenBudget.canConsume(userId, 2000);
      if (!canConsume) {
        throw new Error('Daily token budget exceeded');
      }
    }

    const errors: string[] = [];
    for (const provider of this.getAvailableProviders()) {
      // Already aborted before this provider ran — don't start a new request.
      if (signal?.aborted) break;
      if (!this.isCircuitAllowed(provider.name)) continue;

      try {
        const cleaningOnChunk = (chunk: LlmStreamChunk): void => {
          if (!chunk.content) {
            onChunk(chunk);
            return;
          }
          const cleaned = cleanStreamChunk(chunk.content);
          onChunk(
            cleaned !== chunk.content ? { ...chunk, content: cleaned } : chunk,
          );
        };
        const raw = await provider.completeStream(options, cleaningOnChunk, signal);
        const result = { ...raw, content: cleanLlmContent(raw.content) };
        this.onSuccess(provider.name);
        await this.tokenBudget.consume(
          userId,
          result.tokensIn + result.tokensOut,
        );
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Stream provider ${provider.name} failed: ${msg}`);
        this.onFailure(provider.name);
        errors.push(`${provider.name}: ${msg}`);
        // An aborted stream is an intentional cancel, not a provider fault —
        // do not fail over to another provider (providers normally return the
        // partial on abort; this guards the rare throw-on-abort case).
        if (signal?.aborted) break;
      }
    }

    if (signal?.aborted) {
      // Cancelled before any provider produced a result. Surface a benign
      // partial so the engine's abort-discard path handles it uniformly.
      return {
        content: '',
        tokensIn: 0,
        tokensOut: 0,
        model: 'aborted',
        provider: 'unknown',
        latencyMs: 0,
      };
    }

    throw new Error(`All LLM stream providers failed: ${errors.join('; ')}`);
  }

  async embed(
    userId: string,
    text: string,
    model?: string,
    inputType?: EmbeddingInputType,
  ): Promise<LlmEmbeddingResult> {
    const sanitized = this.sanitizer.sanitize(text);
    const canConsume = await this.tokenBudget.canConsume(userId, 100);
    if (!canConsume) {
      throw new Error('Daily token budget exceeded');
    }
    const provider = this.resolveEmbeddingProvider(model);
    const result = await provider.embed(sanitized, model, inputType);
    await this.tokenBudget.consume(userId, result.tokensUsed);
    return result;
  }

  async embedBatch(
    userId: string,
    texts: string[],
    model?: string,
    inputType?: EmbeddingInputType,
  ): Promise<LlmEmbeddingResult[]> {
    if (texts.length === 0) return [];
    const sanitized = texts.map((t) => this.sanitizer.sanitize(t));
    // 100 tokens per text is a conservative estimate; actual usage is consumed post-call
    const canConsume = await this.tokenBudget.canConsume(
      userId,
      sanitized.length * 100,
    );
    if (!canConsume) {
      throw new Error('Daily token budget exceeded');
    }
    const provider = this.resolveEmbeddingProvider(model);
    const results = await provider.embedBatch(sanitized, model, inputType);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    await this.tokenBudget.consume(userId, totalTokens);
    return results;
  }

  /**
   * Pick the embedding provider by the requested MODEL, not by static
   * preference. An embedding vector is only comparable to another produced by
   * the same provider+model+dimension, so ingest and query MUST resolve
   * identically. The previous "OpenAI-first, ignore the model" logic silently
   * sent a voyage-3 request to OpenAI whenever OPENAI_API_KEY was set — the
   * model string is just a label to OpenAI, so it 404'd / produced an
   * incompatible vector, and doc-RAG returned ~0.08 similarity.
   *
   * Routing rules:
   *  - voyage-*            → voyageai
   *  - text-embedding-*    → openai
   *  - unknown / no model  → first available provider (openai then voyageai)
   * If the model's required provider is unavailable we FAIL LOUD rather than
   * fall back to a different provider that would produce an incomparable vector.
   */
  private resolveEmbeddingProvider(model?: string): ILlmProvider {
    const isVoyageModel = !!model && model.toLowerCase().startsWith('voyage');
    const isOpenAiModel =
      !!model && model.toLowerCase().startsWith('text-embedding');

    if (isVoyageModel) {
      const voyage = this.providers.find(
        (p) => p.name === 'voyageai' && p.isAvailable,
      );
      if (voyage) return voyage;
      throw new Error(
        `Embedding model "${model}" requires the Voyage AI provider, but it is unavailable. Set VOYAGE_AI_API_KEY.`,
      );
    }

    if (isOpenAiModel) {
      const openai = this.providers.find(
        (p) => p.name === 'openai' && p.isAvailable,
      );
      if (openai) return openai;
      throw new Error(
        `Embedding model "${model}" requires the OpenAI provider, but it is unavailable. Set OPENAI_API_KEY.`,
      );
    }

    // No model (or an unrecognized one): fall back to any available provider.
    const provider =
      this.providers.find((p) => p.name === 'openai' && p.isAvailable) ??
      this.providers.find((p) => p.name === 'voyageai' && p.isAvailable);
    if (!provider) {
      throw new Error(
        'No embedding provider available. Set OPENAI_API_KEY or VOYAGE_AI_API_KEY.',
      );
    }
    return provider;
  }

  getProvider(name: string): ILlmProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  async completeEnsemble(
    userId: string,
    options: LlmCompletionOptions,
    providerNames: string[],
    opts?: { skipBudgetCheck?: boolean; skipSanitize?: boolean },
  ): Promise<LlmCompletionResult[]> {
    if (!opts?.skipSanitize) {
      options = {
        ...options,
        messages: options.messages.map((m) => ({
          ...m,
          // TODO(Phase-3): when m.content is LlmContentPart[], text parts inside the array
          // are NOT sanitized. Add per-part sanitization before shipping any engine that
          // constructs multimodal messages from user input.
          content:
            typeof m.content === 'string'
              ? this.sanitizer.sanitize(m.content)
              : m.content,
        })),
      };
    }

    const eligible = providerNames
      .map((n) => this.getProvider(n))
      .filter(
        (p): p is ILlmProvider =>
          !!p && p.isAvailable && this.isCircuitAllowed(p.name),
      );

    if (eligible.length === 0) return [];

    if (!opts?.skipBudgetCheck) {
      const canConsume = await this.tokenBudget.canConsume(
        userId,
        2000 * eligible.length,
      );
      if (!canConsume) {
        throw new Error('Daily token budget exceeded');
      }
    }

    const settled = await Promise.allSettled(
      eligible.map((p) => p.complete(options)),
    );

    const successes: LlmCompletionResult[] = [];
    for (let i = 0; i < settled.length; i++) {
      const provider = eligible[i];
      const r = settled[i];
      if (r.status === 'fulfilled') {
        this.onSuccess(provider.name);
        await this.tokenBudget.consume(
          userId,
          r.value.tokensIn + r.value.tokensOut,
        );
        successes.push(r.value);
      } else {
        const msg =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.error(`Ensemble provider ${provider.name} failed: ${msg}`);
        this.onFailure(provider.name);
      }
    }

    return successes;
  }

  private getAvailableProviders(): ILlmProvider[] {
    return this.providers.filter((p) => p.isAvailable);
  }

  private isCircuitAllowed(providerName: string): boolean {
    const circuit = this.circuits.get(providerName);
    if (!circuit) return false;

    if (circuit.state === 'closed') return true;

    if (circuit.state === 'open') {
      const elapsed = Date.now() - circuit.lastFailure;
      if (elapsed >= CIRCUIT_RESET_MS) {
        circuit.state = 'half-open';
        return true;
      }
      return false;
    }

    return true;
  }

  private onSuccess(providerName: string) {
    const circuit = this.circuits.get(providerName);
    if (circuit) {
      circuit.failures = 0;
      circuit.state = 'closed';
      this.aiMetrics.setCircuitState(providerName, 'closed');
    }
  }

  private onFailure(providerName: string) {
    const circuit = this.circuits.get(providerName);
    if (circuit) {
      circuit.failures++;
      circuit.lastFailure = Date.now();
      if (circuit.failures >= CIRCUIT_THRESHOLD) {
        circuit.state = 'open';
        this.logger.warn(
          `Circuit OPEN for provider ${providerName} after ${circuit.failures} failures`,
        );
      }
      this.aiMetrics.setCircuitState(providerName, circuit.state);
    }
  }
}
