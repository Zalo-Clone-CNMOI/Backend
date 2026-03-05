import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ApiOperationDecorator, CurrentUser } from '@app/decorator';
import { AuthenticatedUser } from '@app/types';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto, DeviceTokenResponseDto } from './dto';

@ApiTags('Device Tokens')
@ApiBearerAuth('BearerAuth')
@Controller('device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  /**
   * Register or update a device token for the current user
   */
  @Post()
  @ApiOperationDecorator({
    summary: 'Register or update device token',
    description:
      'Register a new FCM device token or update an existing one for push notifications',
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
    type: DeviceTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    return this.deviceTokensService.registerToken(user.id, dto);
  }

  /**
   * Get all device tokens for the current user
   */
  @Get()
  @ApiOperationDecorator({
    summary: 'Get all device tokens',
    description: 'Retrieve all active device tokens for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of device tokens',
    type: [DeviceTokenResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserTokens(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeviceTokenResponseDto[]> {
    return this.deviceTokensService.getUserTokens(user.id);
  }

  /**
   * Delete a specific device token
   */
  @Delete(':tokenId')
  @ApiOperationDecorator({
    summary: 'Delete device token',
    description: 'Remove a specific device token from the system',
  })
  @ApiParam({ name: 'tokenId', description: 'Device token ID', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Device token deleted successfully',
    schema: { example: { success: true } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Device token not found' })
  async deleteToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
  ): Promise<{ success: boolean }> {
    return this.deviceTokensService.deleteToken(user.id, tokenId);
  }

  /**
   * Delete all device tokens for the current user
   */
  @Delete()
  @ApiOperationDecorator({
    summary: 'Delete all device tokens',
    description: 'Remove all device tokens for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'All device tokens deleted',
    schema: { example: { count: 3 } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteAllTokens(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    return this.deviceTokensService.deleteAllUserTokens(user.id);
  }
}
