import { Injectable } from '@nestjs/common';
import { PaginatedResponse, PaginationQuery } from '@app/types';
import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  GetGroupInvitesQueryDto,
  GroupInviteItemDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  ConversationListItemDto,
  ConversationDetailDto,
} from './dto';
import { ConversationCoreService } from './services/conversation-core.service';
import { ConversationMemberService } from './services/conversation-member.service';
import { GroupInviteService } from './services/group-invite.service';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly coreService: ConversationCoreService,
    private readonly memberService: ConversationMemberService,
    private readonly inviteService: GroupInviteService,
  ) {}

  getConversations(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<ConversationListItemDto>> {
    return this.coreService.getConversations(userId, query);
  }

  getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.coreService.getConversationById(userId, conversationId);
  }

  createGroupConversation(
    userId: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.createGroupConversation(userId, dto);
  }

  createDirectConversation(
    userId: string,
    dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.createDirectConversation(userId, dto);
  }

  updateConversation(
    userId: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.updateConversation(userId, conversationId, dto);
  }

  addMembers(
    userId: string,
    conversationId: string,
    dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    return this.memberService.addMembers(userId, conversationId, dto);
  }

  removeMember(
    userId: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    return this.memberService.removeMember(userId, conversationId, memberId);
  }

  leaveConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.leaveConversation(userId, conversationId);
  }

  updateMemberRole(
    userId: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
    return this.memberService.updateMemberRole(
      userId,
      conversationId,
      memberId,
      dto,
    );
  }

  updateMySettings(
    userId: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    return this.memberService.updateMySettings(userId, conversationId, dto);
  }

  markAsRead(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.markAsRead(userId, conversationId);
  }

  disbandConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.disbandConversation(userId, conversationId);
  }

  sendGroupInvites(
    userId: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    return this.inviteService.sendGroupInvites(userId, conversationId, dto);
  }

  getPendingGroupInvites(
    userId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.inviteService.getPendingGroupInvites(userId, query);
  }

  getConversationInvites(
    userId: string,
    conversationId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.inviteService.getConversationInvites(
      userId,
      conversationId,
      query,
    );
  }

  acceptGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.acceptGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }

  rejectGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.rejectGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }

  cancelGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.cancelGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }
}
