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

/**
 * AiGatewayService — central router with circuit breaker,
 * fallback ordering, and PII sanitization middleware.
 *
 * Provider ordering: OpenAI (primary) → Gemini → Anthropic
 * Circuit breaker: 5 failures → open for 30s → half-open test
 */
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
  ) {
    // Initialize circuit breakers for each provider
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

  /**
   * Execute a completion with circuit breaker and fallback.
   */
  async complete(
    userId: string,
    options: LlmCompletionOptions,
    opts?: { skipBudgetCheck?: boolean; skipSanitize?: boolean },
  ): Promise<LlmCompletionResult> {
    // PII sanitization
    if (!opts?.skipSanitize) {
      options = {
        ...options,
        messages: options.messages.map((m) => ({
          ...m,
          content: this.sanitizer.sanitize(m.content),
        })),
      };
    }

    // Budget check
    if (!opts?.skipBudgetCheck) {
      const canConsume = await this.tokenBudget.canConsume(userId, 2000);
      if (!canConsume) {
        throw new Error('Daily token budget exceeded');
      }
    }

    // Try providers in order with circuit breaker
    const errors: string[] = [];
    for (const provider of this.getAvailableProviders()) {
      if (!this.isCircuitAllowed(provider.name)) {
        this.logger.warn(`Circuit open for ${provider.name}, skipping`);
        continue;
      }

      try {
        const result = await provider.complete(options);

        this.onSuccess(provider.name);

        // Record token usage
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

  /**
   * Execute a streaming completion with circuit breaker and fallback.
   */
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

  /**
   * Generate embeddings — only OpenAI supports this.
   */
  async embed(text: string, model?: string): Promise<LlmEmbeddingResult> {
    const sanitizedText = this.sanitizer.sanitize(text);
    const provider = this.providers.find(
      (p) => p.name === 'openai' && p.isAvailable,
    );

    if (!provider) {
      throw new Error('OpenAI provider not available for embeddings');
    }

    return provider.embed(sanitizedText, model);
  }

  /**
   * Get provider by name.
   */
  getProvider(name: string): ILlmProvider | undefined {
    return this.providers.find((p) => p.name === name);
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

    // half-open: allow one request
    return true;
  }

  private onSuccess(providerName: string) {
    const circuit = this.circuits.get(providerName);
    if (circuit) {
      circuit.failures = 0;
      circuit.state = 'closed';
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
    }
  }
}
