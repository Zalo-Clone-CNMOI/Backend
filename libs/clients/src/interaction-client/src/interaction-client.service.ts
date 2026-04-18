import { Injectable, Logger } from '@nestjs/common';
import { FriendsApi, ConversationsApi } from './client/generated';
import { BaseHttpClient } from '../../base-http-client';
import type {
  SendFriendRequestDto,
  RespondFriendRequestDto,
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  ConversationDetailDto,
  PaginatedResponseFriendResponseDto,
  PaginatedResponseFriendRequestResponseDto,
  PaginatedResponseSentFriendRequestResponseDto,
  PaginatedResponseConversationListItemDto,
} from './client/generated';

@Injectable()
export class InteractionClientService extends BaseHttpClient {
  protected readonly logger = new Logger(InteractionClientService.name);

  constructor(
    private readonly friendsApi: FriendsApi,
    private readonly conversationsApi: ConversationsApi,
  ) {
    super();
  }

  // ==================== FRIENDS METHODS ====================

  /**
   * Get friends list
   */
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

  /**
   * Get pending friend requests (received)
   */
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

  /**
   * Get sent friend requests
   */
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

  /**
   * Send friend request
   */
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

  /**
   * Respond to friend request
   */
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

  /**
   * Cancel sent friend request
   */
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

  /**
   * Remove friend
   */
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

  /**
   * Block user
   */
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

  /**
   * Unblock user
   */
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

  // ==================== CONVERSATIONS METHODS ====================

  /**
   * Get conversations for current user
   */
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

  /**
   * Get conversation by ID
   */
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

  /**
   * Create group conversation
   */
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

  /**
   * Create or get direct conversation
   */
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

  /**
   * Update conversation
   */
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

  /**
   * Add members to conversation
   */
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

  /**
   * Remove member from conversation
   */
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

  /**
   * Leave conversation
   */
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

  /**
   * Update member role
   */
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

  /**
   * Update my settings
   */
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

  /**
   * Mark conversation as read
   */
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

  /**
   * Pin conversation for current user
   */
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

  /**
   * Unpin conversation for current user
   */
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
}
