import defaultAxios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import type { Configuration } from './configuration';
import type { AiEntityInfoResultEvent, EntityType } from '@libs/contracts';

export interface GetEntityInfoParams {
  text: string;
  type: EntityType;
  lang: string;
  user_id: string;
}

export class EntityInfoApi {
  private readonly basePath: string;
  private readonly axios: AxiosInstance;

  constructor(
    configuration?: Configuration,
    basePath?: string,
    axiosInstance?: AxiosInstance,
  ) {
    this.basePath =
      basePath ?? configuration?.basePath ?? 'http://ai-core-service:5005/api';
    this.axios = axiosInstance ?? defaultAxios;
  }

  getEntityInfo(
    params: GetEntityInfoParams,
    options?: { timeout?: number },
  ): Promise<AxiosResponse<AiEntityInfoResultEvent>> {
    return this.axios.get<AiEntityInfoResultEvent>(
      `${this.basePath}/entity-info`,
      {
        params: {
          text: params.text,
          type: params.type,
          lang: params.lang,
          user_id: params.user_id,
        },
        timeout: options?.timeout ?? 10_000,
      },
    );
  }
}
