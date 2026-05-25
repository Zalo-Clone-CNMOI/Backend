import { Injectable, Logger } from '@nestjs/common';
import {
  FriendsApi,
  ConversationsApi,
  AiConversationsApi,
  type SendFriendRequestDto,
  type RespondFriendRequestDto,
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
  type PaginatedResponseFriendResponseDto,
  type PaginatedResponseFriendRequestResponseDto,
  type PaginatedResponseSentFriendRequestResponseDto,
  type PaginatedResponseConversationListItemDto,
  type UpdateGroupSettingsDto,
} from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  CreatePollPayload,
  EditPollPayload,
  ListPollsQueryPayload,
  ApiInternals,
} from './interaction-client.types';
import {
  getIceServersViaApi,
  getCallHistoryViaApi,
  closePollViaApi,
  retractPollVoteViaApi,
  getPollDetailViaApi,
  createPollViaApi,
  listPollsViaApi,
  editPollViaApi,
  castPollVoteViaApi,
  addPollOptionViaApi,
  removePollOptionViaApi,
} from './interaction-client-calls.helper';

@Injectable()
export class InteractionClientService extends BaseHttpClient {
  protected readonly logger = new Logger(InteractionClientService.name);

  constructor(
    private readonly friendsApi: FriendsApi,
    private readonly conversationsApi: ConversationsApi,
    private readonly aiConversationsApi: AiConversationsApi,
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

  private getInternals(): ApiInternals {
    return this.conversationsApi as unknown as ApiInternals;
  }

  async createPoll(
    accessToken: string,
    conversationId: string,
    dto: CreatePollPayload,
  ): Promise<unknown> {
    try {
      return await createPollViaApi(this.getInternals(), accessToken, {
        conversationId,
        dto,
      });
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
      return await listPollsViaApi(this.getInternals(), accessToken, {
        conversationId,
        query,
      });
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
      return await getPollDetailViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
      });
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
      return await editPollViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
        dto,
      });
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
      return await castPollVoteViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
        optionIds,
      });
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
      return await retractPollVoteViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
      });
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
      return await addPollOptionViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
        label,
      });
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
      return await removePollOptionViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
        optionId,
      });
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
      return await closePollViaApi(this.getInternals(), accessToken, {
        conversationId,
        pollId,
      });
    } catch (error) {
      this.handleError('closePoll', error);
    }
  }

  async getIceServers(accessToken: string) {
    try {
      return await getIceServersViaApi(this.getInternals(), accessToken);
    } catch (error) {
      this.handleError('getIceServers', error);
    }
  }

  async getCallHistory(
    accessToken: string,
    conversationId: string,
    page?: number,
    limit?: number,
  ) {
    try {
      return await getCallHistoryViaApi(this.getInternals(), accessToken, {
        conversationId,
        page,
        limit,
      });
    } catch (error) {
      this.handleError('getCallHistory', error);
    }
  }
  async getOrCreateZaiConversation(
    accessToken: string,
  ): Promise<{ conversationId: string }> {
    try {
      const response = await this.aiConversationsApi.getOrCreateZaiConversation(
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data as { conversationId: string };
    } catch (error) {
      this.handleError('getOrCreateZaiConversation', error);
    }
  }
}
