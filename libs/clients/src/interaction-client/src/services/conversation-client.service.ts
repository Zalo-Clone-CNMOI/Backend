import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationsApi,
  AiConversationsApi,
  type CreateGroupConversationDto,
  type CreateDirectConversationDto,
  type UpdateConversationDto,
  type AddMembersDto,
  type ConversationCallStateResponseDto,
  type UpdateMemberRoleDto,
  type UpdateMemberSettingsDto,
  type EndConversationCallDto,
  type GroupInviteStatus,
  type PaginatedResponseGroupInviteItemDto,
  type SendGroupInvitesDto,
  type SendGroupInvitesResponseDto,
  type ConversationDetailDto,
  type PaginatedResponseConversationListItemDto,
  type UpdateGroupSettingsDto,
  type CreateDocumentConversationDto,
} from '../client/generated';
import { BaseHttpClient } from '../../../base-http-client';

/**
 * Conversation + AI-conversation HTTP calls extracted from
 * InteractionClientService (Phase 6 C13). The facade delegates to this service
 * so the 765-line file drops under the max-lines limit while every call site
 * keeps the same `InteractionClientService` method signatures. Pure move — no
 * behaviour change.
 */
@Injectable()
export class ConversationClientService extends BaseHttpClient {
  protected readonly logger = new Logger(ConversationClientService.name);

  constructor(
    private readonly conversationsApi: ConversationsApi,
    private readonly aiConversationsApi: AiConversationsApi,
  ) {
    super();
  }

  async getConversations(
    accessToken: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponseConversationListItemDto> {
    try {
      const response = await this.conversationsApi.getConversations(
        { page, limit },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getConversations', error);
    }
  }

  async getConversationById(
    accessToken: string,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.getConversationById(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return (response.data as { data: ConversationDetailDto }).data;
    } catch (error) {
      this.handleError('getConversationById', error);
    }
  }

  async createGroupConversation(
    accessToken: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.createGroupConversation(
        { createGroupConversationDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('createGroupConversation', error);
    }
  }

  async createDirectConversation(
    accessToken: string,
    dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.createDirectConversation(
        { createDirectConversationDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('createDirectConversation', error);
    }
  }

  async updateConversation(
    accessToken: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.updateConversation(
        { conversationId, updateConversationDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('updateConversation', error);
    }
  }

  async addMembers(
    accessToken: string,
    conversationId: string,
    dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.addMembers(
        { conversationId, addMembersDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('addMembers', error);
    }
  }

  async removeMember(
    accessToken: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.removeMember(
        { conversationId, memberId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('removeMember', error);
    }
  }

  async leaveConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.leaveConversation(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('leaveConversation', error);
    }
  }

  async disbandConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.disbandConversation(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('disbandConversation', error);
    }
  }

  async sendGroupInvites(
    accessToken: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    try {
      const response = await this.conversationsApi.sendGroupInvites(
        { conversationId, sendGroupInvitesDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('sendGroupInvites', error);
    }
  }

  async getPendingGroupInvites(
    accessToken: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ): Promise<PaginatedResponseGroupInviteItemDto> {
    try {
      const response = await this.conversationsApi.getPendingGroupInvites(
        { page, limit, status },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getPendingGroupInvites', error);
    }
  }

  async getConversationInvites(
    accessToken: string,
    conversationId: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ): Promise<PaginatedResponseGroupInviteItemDto> {
    try {
      const response = await this.conversationsApi.getConversationInvites(
        { conversationId, page, limit, status },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getConversationInvites', error);
    }
  }

  async acceptGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.acceptGroupInvite(
        { conversationId, inviteId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('acceptGroupInvite', error);
    }
  }

  async rejectGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.rejectGroupInvite(
        { conversationId, inviteId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('rejectGroupInvite', error);
    }
  }

  async cancelGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.cancelGroupInvite(
        { conversationId, inviteId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('cancelGroupInvite', error);
    }
  }

  async updateMemberRole(
    accessToken: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.updateMemberRole(
        { conversationId, memberId, updateMemberRoleDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('updateMemberRole', error);
    }
  }

  async updateGroupSettings(
    accessToken: string,
    conversationId: string,
    dto: UpdateGroupSettingsDto,
  ): Promise<ConversationDetailDto> {
    try {
      const response = await this.conversationsApi.updateGroupSettings(
        { conversationId, updateGroupSettingsDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('updateGroupSettings', error);
    }
  }

  async updateMySettings(
    accessToken: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.updateMySettings(
        { conversationId, updateMemberSettingsDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('updateMySettings', error);
    }
  }

  async markAsRead(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.markAsRead(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('markAsRead', error);
    }
  }

  async pinConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.pinConversation(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('pinConversation', error);
    }
  }

  async unpinConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.unpinConversation(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('unpinConversation', error);
    }
  }

  async getConversationCallState(
    accessToken: string,
    conversationId: string,
  ): Promise<ConversationCallStateResponseDto> {
    try {
      const response = await this.conversationsApi.getConversationCallState(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getConversationCallState', error);
    }
  }

  async endConversationCall(
    accessToken: string,
    conversationId: string,
    callId: string,
    dto: EndConversationCallDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.conversationsApi.endConversationCall(
        { conversationId, callId, endConversationCallDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('endConversationCall', error);
    }
  }

  // ── AI conversations ───────────────────────────────────────────────────

  async getOrCreateZaiConversation(
    accessToken: string,
  ): Promise<{ conversationId: string }> {
    try {
      const response = await this.aiConversationsApi.getOrCreateZaiConversation(
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return (response.data as { data: { conversationId: string } }).data;
    } catch (error) {
      this.handleError('getOrCreateZaiConversation', error);
    }
  }

  async getOrCreateDocumentConversation(
    accessToken: string,
    documentId: string,
  ): Promise<{ conversationId: string }> {
    try {
      const dto: CreateDocumentConversationDto = { documentId };
      const response =
        await this.aiConversationsApi.getOrCreateDocumentConversation(
          { createDocumentConversationDto: dto },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
      return (response.data as { data: { conversationId: string } }).data;
    } catch (error) {
      this.handleError('getOrCreateDocumentConversation', error);
    }
  }

  async disbandAiConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.aiConversationsApi.disbandAiConversation(
        { conversationId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return (response.data as { data: { message: string } }).data;
    } catch (error) {
      this.handleError('disbandAiConversation', error);
    }
  }
}
