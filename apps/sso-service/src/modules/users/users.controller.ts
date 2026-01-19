import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

import { ApiOperationDecorator, CurrentUser } from '@app/decorator';
import { AuthenticatedUser, PaginatedResponse } from '@app/types';

import { UsersService } from './users.service';
import {
  UpdateProfileDto,
  SearchUsersDto,
  UserProfileResponseDto,
  PublicUserResponseDto,
  UserSearchResultDto,
} from './dto';

@ApiTags('Users')
@ApiBearerAuth('BearerAuth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get current user profile
   */
  @Get('me')
  @ApiOperationDecorator({
    summary: 'Get current user profile',
    description: '',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileResponseDto> {
    return this.usersService.getMyProfile(user.id);
  }

  /**
   * Update current user profile
   */
  @Patch('me')
  @ApiOperationDecorator({
    summary: 'Update current user profile',
    description: '',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated profile',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async updateMyProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    return this.usersService.updateMyProfile(user.id, dto);
  }

  /**
   * Search users by phone or name
   */
  @Get('search')
  @ApiOperationDecorator({
    summary: 'Search users by phone or name',
    description: '',
  })
  @ApiResponse({ status: 200, description: 'Search results' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: SearchUsersDto,
  ): Promise<PaginatedResponse<UserSearchResultDto>> {
    return this.usersService.searchUsers(dto, user.id);
  }

  /**
   * Get user by ID (public profile)
   */
  @Get(':userId')
  @ApiOperationDecorator({
    summary: 'Get user public profile by ID',
    description: '',
  })
  @ApiParam({ name: 'userId', description: 'User ID', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Public user profile',
    type: PublicUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PublicUserResponseDto> {
    return this.usersService.getUserById(userId, currentUser.id);
  }
}
