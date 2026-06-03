import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConversationType } from '@app/constant';
import { BaseHttpClient } from '../../base-http-client';
import type { MembershipClientConfig } from './utils/providers';

export interface MembershipEntry {
  conversation_id: string;
  allowed: boolean;
  conversation_type: ConversationType | null;
}

export interface SendPermissionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * HTTP client for ws-gateway → interaction-service internal membership checks.
 * Mirrors the raw-axios pattern of MediaClientService.validateAttachments
 * (no generated OpenAPI client). baseUrl already includes interaction-service's
 * '/api' global prefix, so paths start at '/v1/internal/...'.
 */
@Injectable()
export class MembershipClientService extends BaseHttpClient {
  protected readonly logger = new Logger(MembershipClientService.name);

  constructor(
    @Inject('MEMBERSHIP_CLIENT_CONFIG')
    private readonly config: MembershipClientConfig,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  async getMembershipBatch(
    userId: string,
    conversationIds: string[],
  ): Promise<MembershipEntry[]> {
    if (conversationIds.length === 0) return [];
    try {
      const response = await this.httpService.axiosRef.post<{
        entries: MembershipEntry[];
      }>(`${this.config.baseUrl}/v1/internal/membership/batch`, {
        user_id: userId,
        conversation_ids: conversationIds,
      });
      return response.data.entries;
    } catch (error) {
      this.handleError('getMembershipBatch', error);
    }
  }

  async getSendPermission(
    userId: string,
    conversationId: string,
  ): Promise<SendPermissionResult> {
    try {
      const response =
        await this.httpService.axiosRef.post<SendPermissionResult>(
          `${this.config.baseUrl}/v1/internal/membership/send-permission`,
          { user_id: userId, conversation_id: conversationId },
        );
      return response.data;
    } catch (error) {
      this.handleError('getSendPermission', error);
    }
  }

  async listActiveMemberIds(conversationId: string): Promise<string[]> {
    try {
      const response = await this.httpService.axiosRef.post<{
        member_ids: string[];
      }>(`${this.config.baseUrl}/v1/internal/membership/active-members`, {
        conversation_id: conversationId,
      });
      return response.data.member_ids;
    } catch (error) {
      this.handleError('listActiveMemberIds', error);
    }
  }

  async getFriendSet(
    referenceUserId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    try {
      const response = await this.httpService.axiosRef.post<{
        friend_ids: string[];
      }>(`${this.config.baseUrl}/v1/internal/friends/friend-set`, {
        reference_user_id: referenceUserId,
        candidate_ids: candidateIds,
      });
      return response.data.friend_ids;
    } catch (error) {
      this.handleError('getFriendSet', error);
    }
  }
}
