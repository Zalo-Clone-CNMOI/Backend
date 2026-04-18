import { Injectable } from '@nestjs/common';
import {
  InteractionClientService,
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
} from '@app/clients/interaction-client';

@Injectable()
export class ConversationsService {
  constructor(private readonly interactionClient: InteractionClientService) {}

  async getConversations(accessToken: string, page?: number, limit?: number) {
    return this.interactionClient.getConversations(accessToken, page, limit);
  }

  async getConversationById(accessToken: string, conversationId: string) {
    return this.interactionClient.getConversationById(
      accessToken,
      conversationId,
    );
  }

  async createGroupConversation(
    accessToken: string,
    dto: CreateGroupConversationDto,
  ) {
    return this.interactionClient.createGroupConversation(accessToken, dto);
  }

  async createDirectConversation(
    accessToken: string,
    dto: CreateDirectConversationDto,
  ) {
    return this.interactionClient.createDirectConversation(accessToken, dto);
  }

  async updateConversation(
    accessToken: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ) {
    return this.interactionClient.updateConversation(
      accessToken,
      conversationId,
      dto,
    );
  }

  async addMembers(
    accessToken: string,
    conversationId: string,
    dto: AddMembersDto,
  ) {
    return this.interactionClient.addMembers(accessToken, conversationId, dto);
  }

  async removeMember(
    accessToken: string,
    conversationId: string,
    memberId: string,
  ) {
    return this.interactionClient.removeMember(
      accessToken,
      conversationId,
      memberId,
    );
  }

  async leaveConversation(accessToken: string, conversationId: string) {
    return this.interactionClient.leaveConversation(
      accessToken,
      conversationId,
    );
  }

  async updateMemberRole(
    accessToken: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ) {
    return this.interactionClient.updateMemberRole(
      accessToken,
      conversationId,
      memberId,
      dto,
    );
  }

  async updateMySettings(
    accessToken: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ) {
    return this.interactionClient.updateMySettings(
      accessToken,
      conversationId,
      dto,
    );
  }

  async markAsRead(accessToken: string, conversationId: string) {
    return this.interactionClient.markAsRead(accessToken, conversationId);
  }

  async pinConversation(accessToken: string, conversationId: string) {
    return this.interactionClient.pinConversation(accessToken, conversationId);
  }

  async unpinConversation(accessToken: string, conversationId: string) {
    return this.interactionClient.unpinConversation(
      accessToken,
      conversationId,
    );
  }
}
