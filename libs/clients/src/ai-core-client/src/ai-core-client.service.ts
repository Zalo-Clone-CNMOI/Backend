import { Injectable, Logger } from '@nestjs/common';
import { EntityInfoApi, ZaiAssistApi, EntityType } from './client';
import { BaseHttpClient } from '../../base-http-client';
import type { AiEntityInfoResultEvent, AiCatchUpResultEvent } from '@libs/contracts';

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
    type: string;
    lang: string;
    userId: string;
  }): Promise<AiEntityInfoResultEvent> {
    try {
      const response = await this.entityInfoApi.getEntityInfo({
        text: params.text,
        type: params.type as EntityType,
        lang: params.lang,
        userId: params.userId,
      });
      return response.data as unknown as AiEntityInfoResultEvent;
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
        conversationId: params.conversationId,
        userId: params.userId,
        since: params.since,
        limit: params.limit,
      });
      return response.data as unknown as AiCatchUpResultEvent;
    } catch (error) {
      this.handleError('getCatchUpSummary', error);
    }
  }
}
