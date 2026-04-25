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
  TransferOwnershipDto,
  EndConversationCallDto,
  ConversationListItemDto,
  ConversationDetailDto,
  ConversationCallStateResponseDto,
  CreatePollDto,
  EditPollDto,
  CastVoteDto,
  AddPollOptionDto,
  ListPollsQueryDto,
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
   * Transfer ownership to another member
   */
  @Post(':conversationId/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Transfer ownership to another member (owner only)',
  })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Ownership transferred' })
  async transferOwnership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: TransferOwnershipDto,
  ): Promise<{ message: string }> {
    return this.conversationsService.transferOwnership(
      user.id,
      conversationId,
      dto,
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

  /**
   * Pin conversation for current user
   */
  @Post(':conversationId/pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Pin conversation for current user' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Pinned successfully' })
  async pinConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.pinConversation(user.id, conversationId);
  }

  /**
   * Unpin conversation for current user
   */
  @Delete(':conversationId/pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Unpin conversation for current user' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Unpinned successfully' })
  async unpinConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ message: string }> {
    return this.conversationsService.unpinConversation(user.id, conversationId);
  }

  /**
   * Get active call state for conversation
   */
  @Get(':conversationId/call-state')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get active call state for a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Call state retrieved',
    type: ConversationCallStateResponseDto,
  })
  async getConversationCallState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<ConversationCallStateResponseDto> {
    return this.conversationsService.getConversationCallState(
      user.id,
      conversationId,
    );
  }

  /**
   * End active call for conversation
   */
  @Post(':conversationId/calls/:callId/end')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'End active call in a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'callId', description: 'Call ID' })
  @ApiResponse({ status: 200, description: 'Call end requested' })
  async endConversationCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('callId') callId: string,
    @Body() dto: EndConversationCallDto,
  ): Promise<{ message: string }> {
    return this.conversationsService.endConversationCall(
      user.id,
      conversationId,
      callId,
      dto,
    );
  }

  // ─── Polls ──────────────────────────────────────────────

  /**
   * Create poll in a group conversation
   */
  @Post(':conversationId/polls')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create poll in a group conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 201, description: 'Poll created' })
  async createPoll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreatePollDto,
  ) {
    return this.conversationsService.createPoll(user.id, conversationId, dto);
  }

  /**
   * List polls in a conversation (paginated)
   */
  @Get(':conversationId/polls')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'List polls in a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Poll list' })
  async listPolls(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListPollsQueryDto,
  ) {
    return this.conversationsService.listPolls(
      user.id,
      conversationId,
      query,
    );
  }

  /**
   * Get poll detail (options + caller's votes + tally)
   */
  @Get(':conversationId/polls/:pollId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get poll detail' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 200, description: 'Poll detail' })
  async getPollDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
  ) {
    return this.conversationsService.getPollDetail(user.id, pollId);
  }

  /**
   * Edit poll (creator only, while ACTIVE)
   */
  @Patch(':conversationId/polls/:pollId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Edit poll (creator only)' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 200, description: 'Poll edited' })
  async editPoll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: EditPollDto,
  ) {
    return this.conversationsService.editPoll(user.id, pollId, dto);
  }

  /**
   * Cast/replace vote on a poll
   */
  @Post(':conversationId/polls/:pollId/vote')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Cast or replace vote (full desired option set)' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 200, description: 'Vote recorded' })
  async castPollVote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: CastVoteDto,
  ) {
    return this.conversationsService.castPollVote(
      user.id,
      pollId,
      dto.option_ids,
    );
  }

  /**
   * Retract all of caller's votes on a poll
   */
  @Delete(':conversationId/polls/:pollId/vote')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Retract all of caller\'s votes' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 200, description: 'Votes retracted (idempotent)' })
  async retractPollVote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
  ) {
    return this.conversationsService.retractPollVote(user.id, pollId);
  }

  /**
   * Add option to poll (when allow_add_option=true)
   */
  @Post(':conversationId/polls/:pollId/options')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Add option to an active poll' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 201, description: 'Option added' })
  async addPollOption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: AddPollOptionDto,
  ) {
    return this.conversationsService.addPollOption(
      user.id,
      pollId,
      dto.label,
    );
  }

  /**
   * Remove option from poll (creator only, zero votes, > MIN_OPTIONS)
   */
  @Delete(':conversationId/polls/:pollId/options/:optionId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Remove option from poll (creator only)' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiParam({ name: 'optionId', description: 'Option ID' })
  @ApiResponse({ status: 200, description: 'Option removed' })
  async removePollOption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ) {
    return this.conversationsService.removePollOption(
      user.id,
      pollId,
      optionId,
    );
  }

  /**
   * Close poll (creator OR group owner/admin)
   */
  @Post(':conversationId/polls/:pollId/close')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Close poll' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiParam({ name: 'pollId', description: 'Poll ID' })
  @ApiResponse({ status: 200, description: 'Poll closed' })
  async closePoll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
  ) {
    return this.conversationsService.closePoll(user.id, pollId);
  }
}
