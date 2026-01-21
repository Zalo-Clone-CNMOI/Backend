import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@libs/auth';
import { ConversationsService } from './conversations.service';
import { AccessToken } from '@app/decorator';
import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
} from '@app/clients/interaction-client';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all conversations' })
  async getConversations(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.conversationsService.getConversations(token, page, limit);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get conversation by ID' })
  async getConversationById(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.getConversationById(token, conversationId);
  }

  @Post('group')
  @ApiOperation({ summary: 'Create group conversation' })
  async createGroupConversation(
    @AccessToken() token: string,
    @Body() dto: CreateGroupConversationDto,
  ) {
    return this.conversationsService.createGroupConversation(token, dto);
  }

  @Post('direct')
  @ApiOperation({ summary: 'Create or get direct conversation' })
  async createDirectConversation(
    @AccessToken() token: string,
    @Body() dto: CreateDirectConversationDto,
  ) {
    return this.conversationsService.createDirectConversation(token, dto);
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: 'Update conversation' })
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
  async addMembers(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversationsService.addMembers(token, conversationId, dto);
  }

  @Delete(':conversationId/members/:memberId')
  @ApiOperation({ summary: 'Remove member from conversation' })
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
  async leaveConversation(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.leaveConversation(token, conversationId);
  }

  @Patch(':conversationId/members/:memberId/role')
  @ApiOperation({ summary: 'Update member role' })
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
  async markAsRead(
    @AccessToken() token: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.markAsRead(token, conversationId);
  }
}
