import { Injectable } from '@nestjs/common';
import {
  GroupInviteStatus,
  InteractionClientService,
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  EndConversationCallDto,
} from '@app/clients/interaction-client';
import { CreatePollDto, EditPollDto, ListPollsQueryDto } from './dto';

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

  async disbandConversation(accessToken: string, conversationId: string) {
    return this.interactionClient.disbandConversation(
      accessToken,
      conversationId,
    );
  }

  async sendGroupInvites(
    accessToken: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    return this.interactionClient.sendGroupInvites(
      accessToken,
      conversationId,
      dto,
    );
  }

  async getPendingGroupInvites(
    accessToken: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ) {
    return this.interactionClient.getPendingGroupInvites(
      accessToken,
      page,
      limit,
      status,
    );
  }

  async getConversationInvites(
    accessToken: string,
    conversationId: string,
    page?: number,
    limit?: number,
    status?: GroupInviteStatus,
  ) {
    return this.interactionClient.getConversationInvites(
      accessToken,
      conversationId,
      page,
      limit,
      status,
    );
  }

  async acceptGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ) {
    return this.interactionClient.acceptGroupInvite(
      accessToken,
      conversationId,
      inviteId,
    );
  }

  async rejectGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ) {
    return this.interactionClient.rejectGroupInvite(
      accessToken,
      conversationId,
      inviteId,
    );
  }

  async cancelGroupInvite(
    accessToken: string,
    conversationId: string,
    inviteId: string,
  ) {
    return this.interactionClient.cancelGroupInvite(
      accessToken,
      conversationId,
      inviteId,
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

  async getConversationCallState(accessToken: string, conversationId: string) {
    return this.interactionClient.getConversationCallState(
      accessToken,
      conversationId,
    );
  }

  async endConversationCall(
    accessToken: string,
    conversationId: string,
    callId: string,
    dto: EndConversationCallDto,
  ) {
    return this.interactionClient.endConversationCall(
      accessToken,
      conversationId,
      callId,
      dto,
    );
  }

  // ─── Polls passthrough ───────────────────────────────────

  async createPoll(
    accessToken: string,
    conversationId: string,
    dto: CreatePollDto,
  ) {
    return this.interactionClient.createPoll(accessToken, conversationId, dto);
  }

  async listPolls(
    accessToken: string,
    conversationId: string,
    query: ListPollsQueryDto,
  ) {
    return this.interactionClient.listPolls(accessToken, conversationId, query);
  }

  async getPollDetail(
    accessToken: string,
    conversationId: string,
    pollId: string,
  ) {
    return this.interactionClient.getPollDetail(
      accessToken,
      conversationId,
      pollId,
    );
  }

  async editPoll(
    accessToken: string,
    conversationId: string,
    pollId: string,
    dto: EditPollDto,
  ) {
    return this.interactionClient.editPoll(
      accessToken,
      conversationId,
      pollId,
      dto,
    );
  }

  async castPollVote(
    accessToken: string,
    conversationId: string,
    pollId: string,
    optionIds: string[],
  ) {
    return this.interactionClient.castPollVote(
      accessToken,
      conversationId,
      pollId,
      optionIds,
    );
  }

  async retractPollVote(
    accessToken: string,
    conversationId: string,
    pollId: string,
  ) {
    return this.interactionClient.retractPollVote(
      accessToken,
      conversationId,
      pollId,
    );
  }

  async addPollOption(
    accessToken: string,
    conversationId: string,
    pollId: string,
    label: string,
  ) {
    return this.interactionClient.addPollOption(
      accessToken,
      conversationId,
      pollId,
      label,
    );
  }

  async removePollOption(
    accessToken: string,
    conversationId: string,
    pollId: string,
    optionId: string,
  ) {
    return this.interactionClient.removePollOption(
      accessToken,
      conversationId,
      pollId,
      optionId,
    );
  }

  async closePoll(accessToken: string, conversationId: string, pollId: string) {
    return this.interactionClient.closePoll(
      accessToken,
      conversationId,
      pollId,
    );
  }
}
