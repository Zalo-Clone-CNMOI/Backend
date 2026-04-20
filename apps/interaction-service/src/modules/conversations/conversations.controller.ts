import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '@app/decorator';
import {
  AuthenticatedUser,
  PaginatedResponse,
  PaginationQuery,
} from '@app/types';

import { ConversationsService } from './conversations.service';
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

@ApiTags('Conversations')
@ApiBearerAuth('BearerAuth')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /**
   * Get conversations for current user
   */
  @Get()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get conversations for current user' })
  @ApiResponse({
    status: 200,
    description: 'List of conversations',
    type: [ConversationListItemDto],
  })
  async getConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedResponse<ConversationListItemDto>> {
    return this.conversationsService.getConversations(user.id, query);
  }

  /**
   * Get conversation by ID
   */
  @Get(':conversationId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get conversation details' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversation details',
    type: ConversationDetailDto,
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.getConversationById(
      user.id,
      conversationId,
    );
  }

  /**
   * Create group conversation
   */
  @Post('group')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create group conversation' })
  @ApiResponse({
    status: 201,
    description: 'Group created',
    type: ConversationDetailDto,
  })
  async createGroupConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.createGroupConversation(user.id, dto);
  }

  /**
   * Create or get direct conversation
   */
  @Post('direct')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create or get direct conversation' })
  @ApiResponse({
    status: 201,
    description: 'Direct conversation',
    type: ConversationDetailDto,
  })
  async createDirectConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.createDirectConversation(user.id, dto);
  }

  /**
   * Update conversation (group only)
   */
  @Patch(':conversationId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Update conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversation updated',
    type: ConversationDetailDto,
  })
  async updateConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.updateConversation(
      user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Add members to group
   */
  @Post(':conversationId/members')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Add members to group conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({
    status: 201,
    description: 'Members added',
    type: ConversationDetailDto,
  })
  async addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.addMembers(user.id, conversationId, dto);
  }

  /**
   * Remove member from group
   */
  @Delete(':conversationId/members/:memberId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Remove member from group conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'memberId', description: 'Member user ID to remove' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.removeMember(
      user.id,
      conversationId,
      memberId,
    );
  }

  /**
   * Leave conversation
   */
  @Post(':conversationId/leave')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Leave conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Left conversation' })
  async leaveConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.leaveConversation(user.id, conversationId);
  }

  /**
   * Disband group conversation
   */
  @Post(':conversationId/disband')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Disband group conversation (owner only)' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Conversation disbanded' })
  async disbandConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.disbandConversation(
      user.id,
      conversationId,
    );
  }

  /**
   * Send group invites
   */
  @Post(':conversationId/invites')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send invites to group conversation users' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 201, description: 'Invites created' })
  async sendGroupInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    return this.conversationsService.sendGroupInvites(
      user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Get pending invites for current user
   */
  @Get('invites/pending')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get pending group invites for current user' })
  @ApiResponse({ status: 200, description: 'Pending invites list' })
  async getPendingGroupInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.conversationsService.getPendingGroupInvites(user.id, query);
  }

  /**
   * Get invites by conversation (admin/owner)
   */
  @Get(':conversationId/invites')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get group invites by conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Conversation invites list' })
  async getConversationInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.conversationsService.getConversationInvites(
      user.id,
      conversationId,
      query,
    );
  }

  /**
   * Accept invite
   */
  @Post(':conversationId/invites/:inviteId/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Accept group invite' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'inviteId', description: 'Invite ID' })
  @ApiResponse({ status: 200, description: 'Invite accepted' })
  async acceptGroupInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.acceptGroupInvite(
      user.id,
      conversationId,
      inviteId,
    );
  }

  /**
   * Reject invite
   */
  @Post(':conversationId/invites/:inviteId/reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Reject group invite' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'inviteId', description: 'Invite ID' })
  @ApiResponse({ status: 200, description: 'Invite rejected' })
  async rejectGroupInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.rejectGroupInvite(
      user.id,
      conversationId,
      inviteId,
    );
  }

  /**
   * Cancel invite
   */
  @Post(':conversationId/invites/:inviteId/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Cancel group invite' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'inviteId', description: 'Invite ID' })
  @ApiResponse({ status: 200, description: 'Invite cancelled' })
  async cancelGroupInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.cancelGroupInvite(
      user.id,
      conversationId,
      inviteId,
    );
  }

  /**
   * Update member role
   */
  @Patch(':conversationId/members/:memberId/role')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Update member role (owner only)' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'memberId', description: 'Member user ID' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  async updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
    return this.conversationsService.updateMemberRole(
      user.id,
      conversationId,
      memberId,
      dto,
    );
  }

  /**
   * Update my settings in conversation
   */
  @Patch(':conversationId/settings')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Update my settings in conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateMySettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    return this.conversationsService.updateMySettings(
      user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Mark conversation as read
   */
  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Mark conversation as read' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Marked as read' })
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.markAsRead(user.id, conversationId);
  }
}
