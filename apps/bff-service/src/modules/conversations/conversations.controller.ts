import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessToken } from '@app/decorator';
import { ConversationsService } from './conversations.service';
import {
  AddMembersDto,
  AddPollOptionDto,
  CastVoteDto,
  ConversationCallStateResponseDto,
  CreateDirectConversationDto,
  CreateGroupConversationDto,
  CreatePollDto,
  EditPollDto,
  EndConversationCallDto,
  GetGroupInvitesQueryDto,
  ListPollsQueryDto,
  SendGroupInvitesDto,
  UpdateConversationDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
} from './dto';

@ApiTags('Conversations')
@ApiBearerAuth('BearerAuth')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all conversations' })
  @ApiResponse({
    status: 200,
    description: 'List of conversations retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async getConversations(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.conversationsService.getConversations(token, page, limit);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get conversation by ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversation details retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationById(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.getConversationById(token, conversationId);
  }

  @Post('group')
  @ApiOperation({ summary: 'Create group conversation' })
  @ApiResponse({
    status: 201,
    description: 'Group conversation created successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createGroupConversation(
    @AccessToken() token: string,
    @Body() dto: CreateGroupConversationDto,
  ) {
    return this.conversationsService.createGroupConversation(token, dto);
  }

  @Post('direct')
  @ApiOperation({ summary: 'Create or get direct conversation' })
  @ApiResponse({
    status: 201,
    description: 'Direct conversation created or retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async createDirectConversation(
    @AccessToken() token: string,
    @Body() dto: CreateDirectConversationDto,
  ) {
    return this.conversationsService.createDirectConversation(token, dto);
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: 'Update conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async updateConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationsService.updateConversation(
      token,
      conversationId,
      dto,
    );
  }

  @Post(':conversationId/members')
  @ApiOperation({ summary: 'Add members to conversation' })
  @ApiResponse({
    status: 200,
    description: 'Members added successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async addMembers(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversationsService.addMembers(token, conversationId, dto);
  }

  @Delete(':conversationId/members/:memberId')
  @ApiOperation({ summary: 'Remove member from conversation' })
  @ApiResponse({
    status: 200,
    description: 'Member removed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Conversation or member not found' })
  async removeMember(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.conversationsService.removeMember(
      token,
      conversationId,
      memberId,
    );
  }

  @Post(':conversationId/leave')
  @ApiOperation({ summary: 'Leave conversation' })
  @ApiResponse({
    status: 200,
    description: 'Successfully left conversation',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Cannot leave conversation' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async leaveConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.leaveConversation(token, conversationId);
  }

  @Post(':conversationId/disband')
  @ApiOperation({ summary: 'Disband group conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation disbanded successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async disbandConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.disbandConversation(token, conversationId);
  }

  @Post(':conversationId/invites')
  @ApiOperation({ summary: 'Send group invites' })
  @ApiResponse({
    status: 201,
    description: 'Group invites created successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async sendGroupInvites(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendGroupInvitesDto,
  ) {
    return this.conversationsService.sendGroupInvites(
      token,
      conversationId,
      dto,
    );
  }

  @Get('invites/pending')
  @ApiOperation({ summary: 'Get pending group invites for current user' })
  @ApiResponse({
    status: 200,
    description: 'Pending invites retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPendingGroupInvites(
    @AccessToken() token: string,
    @Query() query: GetGroupInvitesQueryDto,
  ) {
    return this.conversationsService.getPendingGroupInvites(
      token,
      query.page,
      query.limit,
      query.status,
    );
  }

  @Get(':conversationId/invites')
  @ApiOperation({ summary: 'Get group invites by conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation invites retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getConversationInvites(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Query() query: GetGroupInvitesQueryDto,
  ) {
    return this.conversationsService.getConversationInvites(
      token,
      conversationId,
      query.page,
      query.limit,
      query.status,
    );
  }

  @Post(':conversationId/invites/:inviteId/accept')
  @ApiOperation({ summary: 'Accept group invite' })
  @ApiResponse({ status: 200, description: 'Invite accepted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async acceptGroupInvite(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.conversationsService.acceptGroupInvite(
      token,
      conversationId,
      inviteId,
    );
  }

  @Post(':conversationId/invites/:inviteId/reject')
  @ApiOperation({ summary: 'Reject group invite' })
  @ApiResponse({ status: 200, description: 'Invite rejected successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async rejectGroupInvite(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.conversationsService.rejectGroupInvite(
      token,
      conversationId,
      inviteId,
    );
  }

  @Post(':conversationId/invites/:inviteId/cancel')
  @ApiOperation({ summary: 'Cancel group invite' })
  @ApiResponse({ status: 200, description: 'Invite cancelled successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async cancelGroupInvite(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.conversationsService.cancelGroupInvite(
      token,
      conversationId,
      inviteId,
    );
  }

  @Patch(':conversationId/members/:memberId/role')
  @ApiOperation({ summary: 'Update member role' })
  @ApiResponse({
    status: 200,
    description: 'Member role updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Conversation or member not found' })
  async updateMemberRole(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.conversationsService.updateMemberRole(
      token,
      conversationId,
      memberId,
      dto,
    );
  }

  @Patch(':conversationId/settings')
  @ApiOperation({ summary: 'Update my settings' })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async updateMySettings(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateMemberSettingsDto,
  ) {
    return this.conversationsService.updateMySettings(
      token,
      conversationId,
      dto,
    );
  }

  @Post(':conversationId/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  @ApiResponse({
    status: 200,
    description: 'Conversation marked as read',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async markAsRead(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.markAsRead(token, conversationId);
  }

  @Post(':conversationId/pin')
  @ApiOperation({ summary: 'Pin conversation for current user' })
  @ApiResponse({ status: 200, description: 'Conversation pinned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async pinConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.pinConversation(token, conversationId);
  }

  @Delete(':conversationId/pin')
  @ApiOperation({ summary: 'Unpin conversation for current user' })
  @ApiResponse({ status: 200, description: 'Conversation unpinned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async unpinConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.unpinConversation(token, conversationId);
  }

  @Get(':conversationId/call-state')
  @ApiOperation({ summary: 'Get active call state for a conversation' })
  @ApiResponse({
    status: 200,
    description: 'Call state retrieved successfully',
    type: ConversationCallStateResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationCallState(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationCallStateResponseDto> {
    const response = await this.conversationsService.getConversationCallState(
      token,
      conversationId,
    );

    return response as ConversationCallStateResponseDto;
  }

  @Post(':conversationId/calls/:callId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End active call in a conversation' })
  @ApiResponse({ status: 200, description: 'Call end requested' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation or call not found' })
  async endConversationCall(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('callId') callId: string,
    @Body() dto: EndConversationCallDto,
  ) {
    return this.conversationsService.endConversationCall(
      token,
      conversationId,
      callId,
      dto,
    );
  }

  // ─── Polls ──────────────────────────────────────────────

  @Post(':conversationId/polls')
  @ApiOperation({ summary: 'Create poll in a group conversation' })
  @ApiResponse({ status: 201, description: 'Poll created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createPoll(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreatePollDto,
  ) {
    return this.conversationsService.createPoll(token, conversationId, dto);
  }

  @Get(':conversationId/polls')
  @ApiOperation({ summary: 'List polls in a conversation' })
  @ApiResponse({ status: 200, description: 'Poll list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listPolls(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Query() query: ListPollsQueryDto,
  ) {
    return this.conversationsService.listPolls(token, conversationId, query);
  }

  @Get(':conversationId/polls/:pollId')
  @ApiOperation({ summary: 'Get poll detail' })
  @ApiResponse({ status: 200, description: 'Poll detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async getPollDetail(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
  ) {
    return this.conversationsService.getPollDetail(
      token,
      conversationId,
      pollId,
    );
  }

  @Patch(':conversationId/polls/:pollId')
  @ApiOperation({ summary: 'Edit poll (creator only)' })
  @ApiResponse({ status: 200, description: 'Poll edited' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async editPoll(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
    @Body() dto: EditPollDto,
  ) {
    return this.conversationsService.editPoll(
      token,
      conversationId,
      pollId,
      dto,
    );
  }

  @Post(':conversationId/polls/:pollId/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cast or replace vote (full desired option set)' })
  @ApiResponse({ status: 200, description: 'Vote recorded' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async castPollVote(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
    @Body() dto: CastVoteDto,
  ) {
    return this.conversationsService.castPollVote(
      token,
      conversationId,
      pollId,
      dto.option_ids,
    );
  }

  @Delete(':conversationId/polls/:pollId/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retract all of caller's votes" })
  @ApiResponse({ status: 200, description: 'Votes retracted (idempotent)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async retractPollVote(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
  ) {
    return this.conversationsService.retractPollVote(
      token,
      conversationId,
      pollId,
    );
  }

  @Post(':conversationId/polls/:pollId/options')
  @ApiOperation({ summary: 'Add option to an active poll' })
  @ApiResponse({ status: 201, description: 'Option added' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async addPollOption(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
    @Body() dto: AddPollOptionDto,
  ) {
    return this.conversationsService.addPollOption(
      token,
      conversationId,
      pollId,
      dto.label,
    );
  }

  @Delete(':conversationId/polls/:pollId/options/:optionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove option from poll (creator only)' })
  @ApiResponse({ status: 200, description: 'Option removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Option not found' })
  async removePollOption(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
    @Param('optionId') optionId: string,
  ) {
    return this.conversationsService.removePollOption(
      token,
      conversationId,
      pollId,
      optionId,
    );
  }

  @Post(':conversationId/polls/:pollId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close poll (creator or group owner/admin)' })
  @ApiResponse({ status: 200, description: 'Poll closed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Poll not found' })
  async closePoll(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Param('pollId') pollId: string,
  ) {
    return this.conversationsService.closePoll(token, conversationId, pollId);
  }
}
