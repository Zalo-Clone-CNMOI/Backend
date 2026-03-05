import { Module } from '@nestjs/common';
import { SsoClientModule } from '@app/clients';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';

@Module({
  imports: [SsoClientModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService],
})
export class DeviceTokensModule {}
