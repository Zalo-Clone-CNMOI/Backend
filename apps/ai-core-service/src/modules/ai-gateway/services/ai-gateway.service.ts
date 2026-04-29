import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmEmbeddingResult,
  LLM_PROVIDERS,
} from '../interfaces';
import { DataSanitizer } from './data-sanitizer.service';
import { TokenBudgetService } from './token-budget.service';
import { AiMetricsService } from './ai-metrics.service';

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
      `AI Gateway initialized with providers: ${providers.map((p) => p.name).join(', ')}`,
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
          content: this.sanitizer.sanitize(m.content),
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
        const result = await provider.complete(options);

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
    opts?: { skipBudgetCheck?: boolean; skipSanitize?: boolean },
  ): Promise<LlmCompletionResult> {
    if (!opts?.skipSanitize) {
      options = {
        ...options,
        messages: options.messages.map((m) => ({
          ...m,
          content: this.sanitizer.sanitize(m.content),
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
      if (!this.isCircuitAllowed(provider.name)) continue;

      try {
        const result = await provider.completeStream(options, onChunk);
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
      }
    }

    throw new Error(`All LLM stream providers failed: ${errors.join('; ')}`);
  }

  async embed(
    userId: string,
    text: string,
    model?: string,
  ): Promise<LlmEmbeddingResult> {
    const sanitized = this.sanitizer.sanitize(text);
    const canConsume = await this.tokenBudget.canConsume(userId, 100);
    if (!canConsume) {
      throw new Error('Daily token budget exceeded');
    }
    const provider = this.providers.find(
      (p) => p.name === 'openai' && p.isAvailable,
    );
    if (!provider) {
      throw new Error('OpenAI provider not available for embeddings');
    }
    const result = await provider.embed(sanitized, model);
    await this.tokenBudget.consume(userId, result.tokensUsed);
    return result;
  }

  async embedBatch(
    userId: string,
    texts: string[],
    model?: string,
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
    const provider = this.providers.find(
      (p) => p.name === 'openai' && p.isAvailable,
    );
    if (!provider) {
      throw new Error('OpenAI provider not available for batch embeddings');
    }
    const results = await provider.embedBatch(sanitized, model);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    await this.tokenBudget.consume(userId, totalTokens);
    return results;
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
          content: this.sanitizer.sanitize(m.content),
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
