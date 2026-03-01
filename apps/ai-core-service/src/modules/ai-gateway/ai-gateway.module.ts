import { Module, Global } from '@nestjs/common';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { LLM_PROVIDERS } from './interfaces';
import { DataSanitizer } from './services/data-sanitizer.service';
import { TokenBudgetService } from './services/token-budget.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { AiGatewayService } from './services/ai-gateway.service';
import { AiMetricsService } from './services/ai-metrics.service';

@Global()
@Module({
  providers: [
    OpenAiProvider,
    GeminiProvider,
    AnthropicProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (
        openai: OpenAiProvider,
        gemini: GeminiProvider,
        anthropic: AnthropicProvider,
      ) => [openai, gemini, anthropic],
      inject: [OpenAiProvider, GeminiProvider, AnthropicProvider],
    },
    DataSanitizer,
    TokenBudgetService,
    PromptBuilderService,
    AiGatewayService,
    AiMetricsService,
  ],
  exports: [
    AiGatewayService,
    PromptBuilderService,
    TokenBudgetService,
    DataSanitizer,
    AiMetricsService,
    OpenAiProvider,
  ],
})
export class AiGatewayModule {}
