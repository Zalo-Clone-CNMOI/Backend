import { Injectable, Logger } from '@nestjs/common';
import {
  FriendsApi,
  ConversationsApi,
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
import { ConversationClientService } from './services/conversation-client.service';

/**
 * Facade over the interaction-service HTTP API. Friend, poll, and call methods
 * live here; conversation + AI-conversation calls are delegated to
 * {@link ConversationClientService} (Phase 6 C13 split). Every public method
 * signature is preserved so BFF call sites are unaffected.
 */
@Injectable()
export class InteractionClientService extends BaseHttpClient {
  protected readonly logger = new Logger(InteractionClientService.name);

  constructor(
    private readonly friendsApi: FriendsApi,
    private readonly conversationsApi: ConversationsApi,
    private readonly conversationClient: ConversationClientService,
  ) {
    super();
  }

  // ── Friends ────────────────────────────────────────────────────────────

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

  // ── Conversations (delegated to ConversationClientService) ───────────────

  getConversations(
    accessToken: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponseConversationListItemDto> {
    return this.conversationClient.getConversations(accessToken, page, limit);
  }

  getConversationById(
    accessToken: string,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.getConversationById(
      accessToken,
      conversationId,
    );
  }

  createGroupConversation(
    accessToken: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.createGroupConversation(accessToken, dto);
  }

  createDirectConversation(
    accessToken: string,
    dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.createDirectConversation(accessToken, dto);
  }

  updateConversation(
    accessToken: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.updateConversation(
      accessToken,
      conversationId,
      dto,
    );
  }

  addMembers(
    accessToken: string,
    conversationId: string,
    dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.addMembers(accessToken, conversationId, dto);
  }

  removeMember(
    accessToken: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.removeMember(
      accessToken,
      conversationId,
      memberId,
    );
  }

  leaveConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.leaveConversation(
      accessToken,
      conversationId,
    );
  }

  disbandConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.disbandConversation(
      accessToken,
      conversationId,
    );
  }

  sendGroupInvites(
    accessToken: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    return this.conversationClient.sendGroupInvites(
      accessToken,
      conversationId,
      dto,
    );
  }

  getPendingGroupInvites(
    accessToken: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ): Promise<PaginatedResponseGroupInviteItemDto> {
    return this.conversationClient.getPendingGroupInvites(
      accessToken,
      page,
      limit,
      status,
    );
  }

  getConversationInvites(
    accessToken: string,
    conversationId: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ): Promise<PaginatedResponseGroupInviteItemDto> {
    return this.conversationClient.getConversationInvites(
      accessToken,
      conversationId,
      page,
      limit,
      status,
    );
  }

  acceptGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.acceptGroupInvite(
      accessToken,
      conversationId,
      inviteId,
    );
  }

  rejectGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.rejectGroupInvite(
      accessToken,
      conversationId,
      inviteId,
    );
  }

  cancelGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.cancelGroupInvite(
      accessToken,
      conversationId,
      inviteId,
    );
  }

  updateMemberRole(
    accessToken: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
    return this.conversationClient.updateMemberRole(
      accessToken,
      conversationId,
      memberId,
      dto,
    );
  }

  updateGroupSettings(
    accessToken: string,
    conversationId: string,
    dto: UpdateGroupSettingsDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationClient.updateGroupSettings(
      accessToken,
      conversationId,
      dto,
    );
  }

  updateMySettings(
    accessToken: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    return this.conversationClient.updateMySettings(
      accessToken,
      conversationId,
      dto,
    );
  }

  markAsRead(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.markAsRead(accessToken, conversationId);
  }

  pinConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.pinConversation(accessToken, conversationId);
  }

  unpinConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.unpinConversation(
      accessToken,
      conversationId,
    );
  }

  getConversationCallState(
    accessToken: string,
    conversationId: string,
  ): Promise<ConversationCallStateResponseDto> {
    return this.conversationClient.getConversationCallState(
      accessToken,
      conversationId,
    );
  }

  endConversationCall(
    accessToken: string,
    conversationId: string,
    callId: string,
    dto: EndConversationCallDto,
  ): Promise<{ message: string }> {
    return this.conversationClient.endConversationCall(
      accessToken,
      conversationId,
      callId,
      dto,
    );
  }

  // ── AI conversations (delegated) ─────────────────────────────────────────

  getOrCreateZaiConversation(
    accessToken: string,
  ): Promise<{ conversationId: string }> {
    return this.conversationClient.getOrCreateZaiConversation(accessToken);
  }

  getOrCreateDocumentConversation(
    accessToken: string,
    documentId: string,
  ): Promise<{ conversationId: string }> {
    return this.conversationClient.getOrCreateDocumentConversation(
      accessToken,
      documentId,
    );
  }

  disbandAiConversation(
    accessToken: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationClient.disbandAiConversation(
      accessToken,
      conversationId,
    );
  }

  // ── Polls + calls (use the shared call helpers via getInternals) ─────────

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
}
