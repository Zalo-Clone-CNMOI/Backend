import defaultAxios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import type { Configuration } from './configuration';
import type {
  AiCatchUpResultEvent,
  AiTranslateResultEvent,
} from '@libs/contracts';

export interface GetCatchUpSummaryParams {
  conversation_id: string;
  user_id: string;
  since?: number;
  limit?: number;
}

export interface TranslateParams {
  text: string;
  target_language: string;
  source_language?: string;
  user_id: string;
}

export class ZaiAssistApi {
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

  getCatchUpSummary(
    params: GetCatchUpSummaryParams,
    options?: { timeout?: number },
  ): Promise<AxiosResponse<AiCatchUpResultEvent>> {
    return this.axios.get<AiCatchUpResultEvent>(`${this.basePath}/catch-up`, {
      params: {
        conversation_id: params.conversation_id,
        user_id: params.user_id,
        since: params.since,
        limit: params.limit,
      },
      timeout: options?.timeout ?? 10_000,
    });
  }

  translate(
    params: TranslateParams,
    options?: { timeout?: number },
  ): Promise<AxiosResponse<AiTranslateResultEvent>> {
    return this.axios.post<AiTranslateResultEvent>(
      `${this.basePath}/translate`,
      {
        text: params.text,
        target_language: params.target_language,
        source_language: params.source_language,
        user_id: params.user_id,
      },
      {
        timeout: options?.timeout ?? 10_000,
      },
    );
  }
}
