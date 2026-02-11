import { Injectable, Logger } from '@nestjs/common';
import {
  SsoClientService,
  DeviceTokenResponseDto,
  RegisterDeviceTokenDto,
} from '@app/clients';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(private readonly ssoClient: SsoClientService) {}

  async registerToken(
    accessToken: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    this.logger.debug(`Proxying register device token request to sso-service`);
    return this.ssoClient.registerDeviceToken(accessToken, dto);
  }

  async getUserTokens(accessToken: string): Promise<DeviceTokenResponseDto[]> {
    this.logger.debug(`Proxying get device tokens request to sso-service`);
    return this.ssoClient.getUserDeviceTokens(accessToken);
  }

  async deleteToken(
    accessToken: string,
    tokenId: string,
  ): Promise<{ success: boolean }> {
    this.logger.debug(
      `Proxying delete device token ${tokenId} request to sso-service`,
    );
    return this.ssoClient.deleteDeviceToken(accessToken, tokenId);
  }

  async deleteAllTokens(accessToken: string): Promise<{ count: number }> {
    this.logger.debug(
      `Proxying delete all device tokens request to sso-service`,
    );
    return this.ssoClient.deleteAllDeviceTokens(accessToken);
  }
}
