import {
  Controller,
  Get,
  Post,
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

import { FriendsService } from './friends.service';
import {
  SendFriendRequestDto,
  RespondFriendRequestDto,
  FriendResponseDto,
  FriendRequestResponseDto,
  SentFriendRequestResponseDto,
} from './dto';

@ApiTags('Friends')
@ApiBearerAuth('BearerAuth')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  /**
   * Get list of friends
   */
  @Get()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get list of friends' })
  @ApiResponse({
    status: 200,
    description: 'List of friends',
    type: [FriendResponseDto],
  })
  async getFriends(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedResponse<FriendResponseDto>> {
    return this.friendsService.getFriends(user.id, query);
  }

  /**
   * Get pending friend requests (received)
   */
  @Get('requests')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get pending friend requests' })
  @ApiResponse({
    status: 200,
    description: 'List of pending requests',
    type: [FriendRequestResponseDto],
  })
  async getPendingRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedResponse<FriendRequestResponseDto>> {
    return this.friendsService.getPendingRequests(user.id, query);
  }

  /**
   * Get sent friend requests
   */
  @Get('requests/sent')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get sent friend requests' })
  @ApiResponse({
    status: 200,
    description: 'List of sent requests',
    type: [SentFriendRequestResponseDto],
  })
  async getSentRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedResponse<SentFriendRequestResponseDto>> {
    return this.friendsService.getSentRequests(user.id, query);
  }

  /**
   * Send friend request
   */
  @Post('requests')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send friend request' })
  @ApiResponse({ status: 201, description: 'Friend request sent' })
  @ApiResponse({ status: 400, description: 'Cannot add yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description: 'Request already exists or already friends',
  })
  async sendFriendRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendFriendRequestDto,
  ): Promise<{ message: string; requestId: string }> {
    return this.friendsService.sendFriendRequest(user.id, dto);
  }

  /**
   * Respond to friend request (accept/reject)
   */
  @Post('requests/:requestId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Respond to friend request' })
  @ApiParam({ name: 'requestId', description: 'Friend request ID' })
  @ApiResponse({ status: 200, description: 'Response recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async respondToRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ): Promise<{ message: string }> {
    return this.friendsService.respondToRequest(user.id, requestId, dto);
  }

  /**
   * Cancel sent friend request
   */
  @Delete('requests/:requestId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Cancel sent friend request' })
  @ApiParam({ name: 'requestId', description: 'Friend request ID' })
  @ApiResponse({ status: 200, description: 'Request cancelled' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async cancelRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<{ message: string }> {
    return this.friendsService.cancelRequest(user.id, requestId);
  }

  /**
   * Remove friend (unfriend)
   */
  @Delete(':friendId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Remove friend' })
  @ApiParam({ name: 'friendId', description: 'Friend user ID' })
  @ApiResponse({ status: 200, description: 'Friend removed' })
  @ApiResponse({ status: 404, description: 'Friend not found' })
  async removeFriend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('friendId', ParseUUIDPipe) friendId: string,
  ): Promise<{ message: string }> {
    return this.friendsService.removeFriend(user.id, friendId);
  }

  /**
   * Block user
   */
  @Post(':userId/block')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Block user' })
  @ApiParam({ name: 'userId', description: 'User ID to block' })
  @ApiResponse({ status: 200, description: 'User blocked' })
  async blockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ message: string }> {
    return this.friendsService.blockUser(user.id, userId);
  }

  /**
   * Unblock user
   */
  @Delete(':userId/block')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Unblock user' })
  @ApiParam({ name: 'userId', description: 'User ID to unblock' })
  @ApiResponse({ status: 200, description: 'User unblocked' })
  async unblockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ message: string }> {
    return this.friendsService.unblockUser(user.id, userId);
  }
}
