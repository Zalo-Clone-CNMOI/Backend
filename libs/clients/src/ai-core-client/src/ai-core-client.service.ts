import { Injectable, Logger } from '@nestjs/common';
import {
  EntityDetectionsApi,
  EntityDetectionsResponseDto,
  EntityInfoApi,
  EntityType,
  ModerationApi,
  PreSendModerationCheckResponseDto,
  ZaiAssistApi,
} from './client';
import { BaseHttpClient } from '../../base-http-client';
import type {
  AiEntityInfoResultEvent,
  AiCatchUpResultEvent,
} from '@libs/contracts';

@Injectable()
export class AiCoreClientService extends BaseHttpClient {
  protected readonly logger = new Logger(AiCoreClientService.name);

  constructor(
    private readonly entityInfoApi: EntityInfoApi,
    private readonly zaiAssistApi: ZaiAssistApi,
    private readonly moderationApi: ModerationApi,
    private readonly entityDetectionsApi: EntityDetectionsApi,
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

  /**
   * Synchronous pre-send moderation check used by chat-service's
   * PreSendModerationService (Phase 5). The internal endpoint must be
   * reachable only from inside the cluster — pre-deploy verification is
   * documented in the Phase 5 plan.
   *
   * @param params.timeoutMs    Hard timeout for the HTTP call (the caller
   *                            treats timeout as fail-open).
   * @param params.traceId      Forwarded as `X-Trace-Id` header so ai-core
   *                            logs correlate with chat-service logs for
   *                            the same request.
   */
  async checkPreSendModeration(params: {
    body: string;
    senderId: string;
    conversationId?: string;
    timeoutMs?: number;
    traceId?: string;
  }): Promise<PreSendModerationCheckResponseDto> {
    try {
      const requestOptions: {
        timeout?: number;
        headers?: Record<string, string>;
      } = {};
      if (typeof params.timeoutMs === 'number') {
        requestOptions.timeout = params.timeoutMs;
      }
      if (params.traceId) {
        requestOptions.headers = { 'X-Trace-Id': params.traceId };
      }

      const response = await this.moderationApi.checkPreSendModeration(
        {
          preSendModerationCheckRequestDto: {
            body: params.body,
            sender_id: params.senderId,
            conversation_id: params.conversationId,
          },
        },
        requestOptions,
      );
      return response.data;
    } catch (error) {
      this.handleError('checkPreSendModeration', error);
    }
  }

  async getEntityDetections(params: {
    conversationId: string;
    userId: string;
  }): Promise<EntityDetectionsResponseDto> {
    try {
      const response = await this.entityDetectionsApi.getEntityDetections({
        conversationId: params.conversationId,
        userId: params.userId,
      });
      return response.data;
    } catch (error) {
      this.handleError('getEntityDetections', error);
    }
  }
}
