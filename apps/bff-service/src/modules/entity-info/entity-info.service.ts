import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { CacheService } from '@libs/redis';
import { AiCoreClientService } from '@app/clients';
import type { AiEntityInfoResultEvent, EntityType } from '@libs/contracts';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

@Injectable()
export class EntityInfoService {
  private readonly logger = new Logger(EntityInfoService.name);

  constructor(
    private readonly aiCoreClient: AiCoreClientService,
    private readonly cache: CacheService,
  ) {}

  async getEntityInfo(params: {
    text: string;
    type: EntityType;
    lang: string;
    userId: string;
  }): Promise<AiEntityInfoResultEvent> {
    const cacheKey = this.cacheKey(params.text, params.type, params.lang);

    const cached = await this.cache.get<AiEntityInfoResultEvent>(cacheKey);
    if (cached) {
      this.logger.debug(`Entity info cache hit: ${cacheKey}`);
      return cached;
    }

    const result = await this.aiCoreClient.getEntityInfo(params);
    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  private cacheKey(text: string, type: string, lang: string): string {
    const hash = createHash('sha256')
      .update(`${text}|${type}|${lang}`)
      .digest('hex')
      .slice(0, 32);
    return `ai:entity-info:${hash}`;
  }
}
