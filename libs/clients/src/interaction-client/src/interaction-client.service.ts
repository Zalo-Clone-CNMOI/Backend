import { Injectable, Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { FriendsApi, ConversationsApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  SendFriendRequestDto,
  RespondFriendRequestDto,
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  ConversationCallStateResponseDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  EndConversationCallDto,
  GroupInviteStatus,
  PaginatedResponseGroupInviteItemDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
  ConversationDetailDto,
  PaginatedResponseFriendResponseDto,
  PaginatedResponseFriendRequestResponseDto,
  PaginatedResponseSentFriendRequestResponseDto,
  PaginatedResponseConversationListItemDto,
} from './client/generated';

export interface CreatePollPayload {
  question: string;
  options: { label: string }[];
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  is_anonymous?: boolean;
  expires_in_hours?: number;
}

export interface EditPollPayload {
  question?: string;
  allow_multiple?: boolean;
  allow_add_option?: boolean;
  expires_at?: string | null;
  edited_option_labels?: { option_id: string; label: string }[];
}

export interface ListPollsQueryPayload {
  status?: string;
  page?: number;
  limit?: number;
}

export interface IceServerConfigEntry {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  username: string;
  credential: string;
  ttl: number;
  ice_servers: IceServerConfigEntry[];
}

export interface CallHistoryItem {
  id: string;
  conversationId: string;
  initiatorId: string;
  callType: 'audio' | 'video';
  conversationType: 'direct' | 'group';
  status: 'completed' | 'missed' | 'rejected' | 'timeout';
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  participantIds: string[];
  reason: string | null;
}

export interface CallHistoryResponse {
  items: CallHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

type ApiInternals = {
  axios: AxiosInstance;
  basePath: string;
};

@Injectable()
export class InteractionClientService extends BaseHttpClient {
  protected readonly logger = new Logger(InteractionClientService.name);

  constructor(
    private readonly friendsApi: FriendsApi,
    private readonly conversationsApi: ConversationsApi,
  ) {
    super();
  }

  async getFriends(
    accessToken: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponseFriendResponseDto> {
    try {
      const response = await this.friendsApi.getFriends(
        { page, limit },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getFriends', error);
    }
  }

  async getPendingRequests(
    accessToken: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponseFriendRequestResponseDto> {
    try {
      const response = await this.friendsApi.getPendingRequests(
        { page, limit },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getPendingRequests', error);
    }
  }

  async getSentRequests(
    accessToken: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponseSentFriendRequestResponseDto> {
    try {
      const response = await this.friendsApi.getSentRequests(
        { page, limit },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data;
    } catch (error) {
      this.handleError('getSentRequests', error);
    }
  }

  async sendFriendRequest(
    accessToken: string,
    dto: SendFriendRequestDto,
  ): Promise<{ message: string; requestId: string }> {
    try {
      const response = await this.friendsApi.sendFriendRequest(
        { sendFriendRequestDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string; requestId: string };
    } catch (error) {
      this.handleError('sendFriendRequest', error);
    }
  }

  async respondToRequest(
    accessToken: string,
    requestId: string,
    dto: RespondFriendRequestDto,
  ): Promise<{ message: string }> {
    try {
      const response = await this.friendsApi.respondToRequest(
        { requestId, respondFriendRequestDto: dto },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('respondToRequest', error);
    }
  }

  async cancelRequest(
    accessToken: string,
    requestId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.friendsApi.cancelRequest(
        { requestId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('cancelRequest', error);
    }
  }

  async removeFriend(
    accessToken: string,
    friendId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.friendsApi.removeFriend(
        { friendId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('removeFriend', error);
    }
  }

  async blockUser(
    accessToken: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.friendsApi.blockUser(
        { userId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('blockUser', error);
    }
  }

  async unblockUser(
    accessToken: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      const response = await this.friendsApi.unblockUser(
        { userId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { message: string };
    } catch (error) {
      this.handleError('unblockUser', error);
    }
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
      return response.data;
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

  private getInternals(): ApiInternals {
    return this.conversationsApi as unknown as ApiInternals;
  }

  private authHeaders(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async createPoll(
    accessToken: string,
    conversationId: string,
    dto: CreatePollPayload,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.post(
        `${basePath}/conversations/${conversationId}/polls`,
        dto,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('createPoll', error);
    }
  }

  async listPolls(
    accessToken: string,
    conversationId: string,
    query: ListPollsQueryPayload = {},
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.get(
        `${basePath}/conversations/${conversationId}/polls`,
        {
          params: query,
          headers: this.authHeaders(accessToken),
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('listPolls', error);
    }
  }

  async getPollDetail(
    accessToken: string,
    conversationId: string,
    pollId: string,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.get(
        `${basePath}/conversations/${conversationId}/polls/${pollId}`,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('getPollDetail', error);
    }
  }

  async editPoll(
    accessToken: string,
    conversationId: string,
    pollId: string,
    dto: EditPollPayload,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.patch(
        `${basePath}/conversations/${conversationId}/polls/${pollId}`,
        dto,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('editPoll', error);
    }
  }

  async castPollVote(
    accessToken: string,
    conversationId: string,
    pollId: string,
    optionIds: string[],
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.post(
        `${basePath}/conversations/${conversationId}/polls/${pollId}/vote`,
        { option_ids: optionIds },
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('castPollVote', error);
    }
  }

  async retractPollVote(
    accessToken: string,
    conversationId: string,
    pollId: string,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.delete(
        `${basePath}/conversations/${conversationId}/polls/${pollId}/vote`,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('retractPollVote', error);
    }
  }

  async addPollOption(
    accessToken: string,
    conversationId: string,
    pollId: string,
    label: string,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.post(
        `${basePath}/conversations/${conversationId}/polls/${pollId}/options`,
        { label },
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('addPollOption', error);
    }
  }

  async removePollOption(
    accessToken: string,
    conversationId: string,
    pollId: string,
    optionId: string,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.delete(
        `${basePath}/conversations/${conversationId}/polls/${pollId}/options/${optionId}`,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('removePollOption', error);
    }
  }

  async closePoll(
    accessToken: string,
    conversationId: string,
    pollId: string,
  ): Promise<unknown> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.post(
        `${basePath}/conversations/${conversationId}/polls/${pollId}/close`,
        undefined,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('closePoll', error);
    }
  }

  async getIceServers(accessToken: string): Promise<IceServersResponse> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.get<IceServersResponse>(
        `${basePath}/calls/ice-servers`,
        { headers: this.authHeaders(accessToken) },
      );
      return response.data;
    } catch (error) {
      this.handleError('getIceServers', error);
    }
  }

  async getCallHistory(
    accessToken: string,
    conversationId: string,
    page?: number,
    limit?: number,
  ): Promise<CallHistoryResponse> {
    try {
      const { axios, basePath } = this.getInternals();
      const response = await axios.get<CallHistoryResponse>(
        `${basePath}/conversations/${conversationId}/calls`,
        {
          params: { page, limit },
          headers: this.authHeaders(accessToken),
        },
      );
      return response.data;
    } catch (error) {
      this.handleError('getCallHistory', error);
    }
  }
}
