import { Injectable, Logger } from '@nestjs/common';
import type { Tiktoken, TiktokenModel } from 'js-tiktoken';

const DEFAULT_MODEL: TiktokenModel = 'text-embedding-3-small';

export interface ChunkOptions {
  size: number;
  overlap: number;
  model?: TiktokenModel;
}

@Injectable()
export class TextChunkerService {
  private readonly logger = new Logger(TextChunkerService.name);
  private readonly encoderCache = new Map<TiktokenModel, Tiktoken>();
  private readonly encoderInit = new Map<TiktokenModel, Promise<Tiktoken>>();

  async chunk(text: string, opts: ChunkOptions): Promise<string[]> {
    if (opts.size <= 0) {
      throw new Error(`chunk size must be positive (got ${opts.size})`);
    }
    if (opts.overlap < 0) {
      throw new Error(
        `chunk overlap must be non-negative (got ${opts.overlap})`,
      );
    }
    if (opts.overlap >= opts.size) {
      throw new Error(
        `chunk overlap (${opts.overlap}) must be less than size (${opts.size})`,
      );
    }
    if (!text.trim()) return [];

    const enc = await this.getEncoder(opts.model ?? DEFAULT_MODEL);
    const tokens = enc.encode(text);
    if (tokens.length === 0) return [];

    const chunks: string[] = [];
    const step = opts.size - opts.overlap;

    for (let i = 0; i < tokens.length; i += step) {
      const slice = tokens.slice(i, i + opts.size);
      const decoded = enc.decode(slice).trim();
      if (decoded) chunks.push(decoded);
    }

    return chunks;
  }

  async countTokens(
    text: string,
    model: TiktokenModel = DEFAULT_MODEL,
  ): Promise<number> {
    const enc = await this.getEncoder(model);
    return enc.encode(text).length;
  }

  private async getEncoder(model: TiktokenModel): Promise<Tiktoken> {
    const cached = this.encoderCache.get(model);
    if (cached) {
      return cached;
    }

    const inflight = this.encoderInit.get(model);
    if (inflight) {
      return inflight;
    }

    const initPromise = (async () => {
      const { encodingForModel } = await import('js-tiktoken');
      try {
        const encoder = encodingForModel(model);
        this.encoderCache.set(model, encoder);
        this.logger.debug(`Tiktoken encoder loaded for model: ${model}`);
        return encoder;
      } catch (error) {
        throw new Error(
          `Failed to load tokenizer for model "${model}": ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.encoderInit.delete(model);
      }
    })();

    this.encoderInit.set(model, initPromise);
    return initPromise;
  }
}
