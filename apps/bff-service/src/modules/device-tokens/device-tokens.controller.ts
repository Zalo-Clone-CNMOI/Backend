import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiOperation,
} from '@nestjs/swagger';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokenResponseDto, RegisterDeviceTokenDto } from '@app/clients';

@ApiTags('Device Tokens')
@ApiBearerAuth('BearerAuth')
@Controller('device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  private extractAccessToken(authorization: string): string {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }
    return authorization.substring(7);
  }

  @Post()
  @ApiOperation({
    summary: 'Register or update device token',
    description:
      'Register a new FCM device token or update an existing one for push notifications',
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerToken(
    @Headers('authorization') authorization: string,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    const accessToken = this.extractAccessToken(authorization);
    return this.deviceTokensService.registerToken(accessToken, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all device tokens',
    description: 'Retrieve all active device tokens for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of device tokens',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserTokens(
    @Headers('authorization') authorization: string,
  ): Promise<DeviceTokenResponseDto[]> {
    const accessToken = this.extractAccessToken(authorization);
    return this.deviceTokensService.getUserTokens(accessToken);
  }

  @Delete(':tokenId')
  @ApiOperation({
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
    @Headers('authorization') authorization: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
  ): Promise<{ success: boolean }> {
    const accessToken = this.extractAccessToken(authorization);
    return this.deviceTokensService.deleteToken(accessToken, tokenId);
  }

  @Delete()
  @ApiOperation({
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
    @Headers('authorization') authorization: string,
  ): Promise<{ count: number }> {
    const accessToken = this.extractAccessToken(authorization);
    return this.deviceTokensService.deleteAllTokens(accessToken);
  }
}
