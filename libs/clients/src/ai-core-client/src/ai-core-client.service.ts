import { Injectable, Logger } from '@nestjs/common';
import { EntityInfoApi } from './client';
import { BaseHttpClient } from '../../base-http-client';
import type { AiEntityInfoResultEvent, EntityType } from '@libs/contracts';

@Injectable()
export class AiCoreClientService extends BaseHttpClient {
  protected readonly logger = new Logger(AiCoreClientService.name);

  constructor(private readonly entityInfoApi: EntityInfoApi) {
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
}
