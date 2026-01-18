import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UnauthorizedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  UpdateProfileDto,
  SearchUsersDto,
  UserProfileResponseDto,
  PublicUserResponseDto,
  PaginatedUserSearchResultDto,
} from './dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private extractAccessToken(authorization: string): string {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }
    return authorization.substring(7);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description: "Get authenticated user's profile information",
  })
  @ApiResponse({
    status: 200,
    description: 'User profile',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyProfile(
    @Headers('authorization') authorization: string,
  ): Promise<UserProfileResponseDto> {
    const accessToken = this.extractAccessToken(authorization);
    return this.usersService.getMyProfile(accessToken);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update current user profile',
    description: "Update authenticated user's profile information",
  })
  @ApiResponse({
    status: 200,
    description: 'Updated profile',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async updateMyProfile(
    @Headers('authorization') authorization: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    const accessToken = this.extractAccessToken(authorization);
    return this.usersService.updateMyProfile(accessToken, dto);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search users by phone or name',
    description: 'Search for users with pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results',
    type: PaginatedUserSearchResultDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchUsers(
    @Headers('authorization') authorization: string,
    @Query() dto: SearchUsersDto,
  ): Promise<PaginatedUserSearchResultDto> {
    const accessToken = this.extractAccessToken(authorization);
    return this.usersService.searchUsers(
      accessToken,
      dto.q,
      dto.page,
      dto.limit,
    );
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get user public profile by ID',
    description: "Get a user's public profile information",
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'User public profile',
    type: PublicUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getPublicProfile(
    @Headers('authorization') authorization: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PublicUserResponseDto> {
    const accessToken = this.extractAccessToken(authorization);
    return this.usersService.getPublicProfile(accessToken, userId);
  }
}
