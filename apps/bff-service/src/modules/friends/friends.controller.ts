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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { AccessToken } from '@app/decorator';
import { RespondFriendRequestDto, SendFriendRequestDto } from './dto';

@ApiTags('Friends')
@ApiBearerAuth('BearerAuth')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get friends list' })
  async getFriends(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getFriends(token, page, limit);
  }

  @Get('requests/pending')
  @ApiOperation({ summary: 'Get pending friend requests (received)' })
  async getPendingRequests(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getPendingRequests(token, page, limit);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: 'Get sent friend requests' })
  async getSentRequests(
    @AccessToken() token: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.friendsService.getSentRequests(token, page, limit);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Send friend request' })
  async sendFriendRequest(
    @AccessToken() token: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendFriendRequest(token, dto);
  }

  @Patch('requests/:requestId')
  @ApiOperation({ summary: 'Respond to friend request' })
  async respondToRequest(
    @AccessToken() token: string,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.respondToRequest(token, requestId, dto);
  }

  @Delete('requests/:requestId')
  @ApiOperation({ summary: 'Cancel sent friend request' })
  async cancelRequest(
    @AccessToken() token: string,
    @Param('requestId') requestId: string,
  ) {
    return this.friendsService.cancelRequest(token, requestId);
  }

  @Delete(':friendId')
  @ApiOperation({ summary: 'Remove friend' })
  async removeFriend(
    @AccessToken() token: string,
    @Param('friendId') friendId: string,
  ) {
    return this.friendsService.removeFriend(token, friendId);
  }

  @Post(':userId/block')
  @ApiOperation({ summary: 'Block user' })
  async blockUser(
    @AccessToken() token: string,
    @Param('userId') userId: string,
  ) {
    return this.friendsService.blockUser(token, userId);
  }

  @Delete(':userId/block')
  @ApiOperation({ summary: 'Unblock user' })
  async unblockUser(
    @AccessToken() token: string,
    @Param('userId') userId: string,
  ) {
    return this.friendsService.unblockUser(token, userId);
  }
}
