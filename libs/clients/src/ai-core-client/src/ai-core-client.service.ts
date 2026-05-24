import { Injectable, Logger } from '@nestjs/common';
import { EntityInfoApi, ZaiAssistApi } from './client';
import { BaseHttpClient } from '../../base-http-client';
import type {
  AiEntityInfoResultEvent,
  EntityType,
  AiCatchUpResultEvent,
  AiTranslateResultEvent,
} from '@libs/contracts';

@Injectable()
export class AiCoreClientService extends BaseHttpClient {
  protected readonly logger = new Logger(AiCoreClientService.name);

  constructor(
    private readonly entityInfoApi: EntityInfoApi,
    private readonly zaiAssistApi: ZaiAssistApi,
  ) {
    super();
  }

  async getEntityInfo(params: {
    text: string;
    type: EntityType;
    lang: string;
    userId: string;
  }): Promise<AiEntityInfoResultEvent> {
    try {
      const response = await this.entityInfoApi.getEntityInfo({
        text: params.text,
        type: params.type,
        lang: params.lang,
        user_id: params.userId,
      });
      return response.data;
    } catch (error) {
      this.handleError('getEntityInfo', error);
    }
  }

  async getCatchUpSummary(params: {
    conversationId: string;
    userId: string;
    since?: number;
    limit?: number;
  }): Promise<AiCatchUpResultEvent> {
    try {
      const response = await this.zaiAssistApi.getCatchUpSummary({
        conversation_id: params.conversationId,
        user_id: params.userId,
        since: params.since,
        limit: params.limit,
      });
      return response.data;
    } catch (error) {
      this.handleError('getCatchUpSummary', error);
    }
  }

  async translate(params: {
    text: string;
    targetLanguage: string;
    sourceLanguage?: string;
    userId: string;
  }): Promise<AiTranslateResultEvent> {
    try {
      const response = await this.zaiAssistApi.translate({
        text: params.text,
        target_language: params.targetLanguage,
        source_language: params.sourceLanguage,
        user_id: params.userId,
      });
      return response.data;
    } catch (error) {
      this.handleError('translate', error);
    }
  }
}
