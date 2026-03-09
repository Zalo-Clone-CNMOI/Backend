import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';

/**
 * PII Data Sanitizer — strips personally identifiable information
 * from text before sending to LLM providers.
 *
 * Configurable via `aiEnablePiiSanitization` flag.
 * English-only patterns for MVP.
 */
@Injectable()
export class DataSanitizer {
  private readonly logger = new Logger(DataSanitizer.name);
  private readonly enabled: boolean;

  // Common PII patterns (English-only MVP)
  private readonly patterns: Array<{ regex: RegExp; replacement: string }> = [
    // Email addresses
    {
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: '[EMAIL]',
    },
    // Credit card numbers — matched BEFORE phone to avoid partial phone match
    {
      regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
      replacement: '[CREDIT_CARD]',
    },
    // Phone numbers (various formats)
    {
      regex:
        /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
      replacement: '[PHONE]',
    },
    // SSN-like patterns
    {
      regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
      replacement: '[SSN]',
    },
    // IP addresses
    {
      regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      replacement: '[IP_ADDRESS]',
    },
  ];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.enabled = config.aiEnablePiiSanitization !== false;
    if (this.enabled) {
      this.logger.log('PII sanitization enabled');
    }
  }

  /**
   * Sanitize text by replacing PII patterns with placeholders.
   */
  sanitize(text: string): string {
    if (!this.enabled || !text) return text;

    let sanitized = text;
    for (const pattern of this.patterns) {
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
    return sanitized;
  }

  /**
   * Batch sanitize multiple texts.
   */
  sanitizeAll(texts: string[]): string[] {
    return texts.map((t) => this.sanitize(t));
  }
}
