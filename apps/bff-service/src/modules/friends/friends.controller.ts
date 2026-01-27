import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
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
import { FriendsService } from './friends.service';
import { AccessToken } from '@app/decorator';
import {
  SendFriendRequestDto,
  RespondFriendRequestDto,
} from '@app/clients/interaction-client';

@ApiTags('Friends')
@ApiBearerAuth('BearerAuth')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get friends list' })
  @ApiResponse({
    status: 200,
    description: 'Friends list retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getFriends(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getFriends(token, page, limit);
  }

  @Get('requests/pending')
  @ApiOperation({ summary: 'Get pending friend requests (received)' })
  @ApiResponse({
    status: 200,
    description: 'Pending friend requests retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPendingRequests(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getPendingRequests(token, page, limit);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: 'Get sent friend requests' })
  @ApiResponse({
    status: 200,
    description: 'Sent friend requests retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSentRequests(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getSentRequests(token, page, limit);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Send friend request' })
  @ApiResponse({
    status: 201,
    description: 'Friend request sent successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Friend request already exists' })
  async sendFriendRequest(
    @AccessToken() token: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendFriendRequest(token, dto);
  }

  @Patch('requests/:requestId')
  @ApiOperation({ summary: 'Respond to friend request' })
  @ApiResponse({
    status: 200,
    description: 'Friend request response recorded successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Friend request not found' })
  @ApiResponse({ status: 409, description: 'Friend request already responded' })
  async respondToRequest(
    @AccessToken() token: string,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.respondToRequest(token, requestId, dto);
  }

  @Delete('requests/:requestId')
  @ApiOperation({ summary: 'Cancel sent friend request' })
  @ApiResponse({
    status: 200,
    description: 'Friend request cancelled successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Cannot cancel this request' })
  @ApiResponse({ status: 404, description: 'Friend request not found' })
  async cancelRequest(
    @AccessToken() token: string,
    @Param('requestId') requestId: string,
  ) {
    return this.friendsService.cancelRequest(token, requestId);
  }

  @Delete(':friendId')
  @ApiOperation({ summary: 'Remove friend' })
  @ApiResponse({
    status: 200,
    description: 'Friend removed successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Friendship not found' })
  async removeFriend(
    @AccessToken() token: string,
    @Param('friendId') friendId: string,
  ) {
    return this.friendsService.removeFriend(token, friendId);
  }

  @Post(':userId/block')
  @ApiOperation({ summary: 'Block user' })
  @ApiResponse({
    status: 200,
    description: 'User blocked successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already blocked' })
  async blockUser(
    @AccessToken() token: string,
    @Param('userId') userId: string,
  ) {
    return this.friendsService.blockUser(token, userId);
  }

  @Delete(':userId/block')
  @ApiOperation({ summary: 'Unblock user' })
  @ApiResponse({
    status: 200,
    description: 'User unblocked successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found or not blocked' })
  async unblockUser(
    @AccessToken() token: string,
    @Param('userId') userId: string,
  ) {
    return this.friendsService.unblockUser(token, userId);
  }
}
